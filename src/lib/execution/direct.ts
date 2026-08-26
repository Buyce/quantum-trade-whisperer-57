/**
 * Prompt 14 Stage 3 — the PURE half of direct broker execution.
 *
 * P-Trades constructs the order itself, server-side, from the published plan
 * and the authoritative Prompt-12 quantity. Nothing about an order is ever
 * taken from a client request, and nothing is invented when an input is
 * missing: every rule below either produces a complete order or refuses.
 *
 * Order shape is fixed by the named execution policy `single_exit_first_target`:
 * ONE pending limit order, stop loss and first target attached in the same
 * submission, expiring at the plan's time-in-force. TP2/TP3 are shown to the
 * trader but are never managed at the broker, so the broker result and the
 * engine's own statistics describe the same object.
 *
 * Pure: no fetch, no clock beyond the `now` argument, no env, no Supabase.
 */
import { ORDER_TIF_MINUTES, clampAutoOrderWindowMinutes } from "@/lib/db-types";
import { buildClientId, PTRADES_STRATEGY_ID } from "@/lib/metaapi/client-id";
import type { AccountMode } from "@/lib/accounts/types";
import type {
  MarketOrderActionType,
  MarketOrderRequest,
  PendingOrderActionType,
  PendingOrderRequest,
} from "@/lib/metaapi/types";
import type { TradeVerdict } from "@/lib/metaapi/trade-result";
import type { DeliveryState, OrderQuantity } from "@/lib/delivery/execution";

export type DeliveryDestination = "bridge_json" | "metaapi_direct";

/** Modes that may actually submit an order. OBSERVE never can. */
export function modeSubmitsOrders(mode: AccountMode): boolean {
  return mode === "demo_auto" || mode === "live_auto";
}

/**
 * `live_confirm` requires a human to press a button per setup, so it is NOT an
 * automatic destination: the worker never submits for it.
 */
export function modeIsAutomatic(mode: AccountMode): boolean {
  return mode === "demo_auto" || mode === "live_auto";
}

export interface DirectGateInput {
  mode: AccountMode;
  /** Broker's own answer, never the trader's intent. */
  brokerAccountType: "demo" | "real" | "contest" | "unknown";
  tradeAllowed: boolean | null;
  investorMode: boolean | null;
  ready: boolean;
  intentConflict: boolean;
  /** System-wide gates, all default OFF. */
  globalDemoAuto: boolean;
  globalLiveAuto: boolean;
}

export type DirectGateVerdict = { ok: true } | { ok: false; detail: string };

/**
 * Whether this account may be sent an automatic order right now. Every unknown
 * resolves to refusal.
 */
export function directExecutionAllowed(input: DirectGateInput): DirectGateVerdict {
  if (!input.ready) return { ok: false, detail: "the broker has not confirmed this account yet" };
  if (input.intentConflict) {
    return { ok: false, detail: "the account type contradicts the connection intent" };
  }
  if (input.tradeAllowed !== true) {
    return { ok: false, detail: "the broker reports trading is not allowed on this account" };
  }
  if (input.investorMode === true) {
    return { ok: false, detail: "this account is connected read-only (investor password)" };
  }
  if (!modeIsAutomatic(input.mode)) {
    return { ok: false, detail: `mode ${input.mode} does not submit automatic orders` };
  }
  if (input.mode === "demo_auto") {
    if (input.brokerAccountType !== "demo") {
      return {
        ok: false,
        detail: `Demo Auto requires a broker-confirmed demo account; broker reports ${input.brokerAccountType}`,
      };
    }
    if (!input.globalDemoAuto) {
      return { ok: false, detail: "automatic demo execution is disabled system-wide" };
    }
    return { ok: true };
  }
  if (input.brokerAccountType !== "real") {
    return {
      ok: false,
      detail: `Live Auto requires a broker-confirmed real account; broker reports ${input.brokerAccountType}`,
    };
  }
  if (!input.globalLiveAuto) {
    return { ok: false, detail: "automatic live execution is disabled system-wide" };
  }
  return { ok: true };
}

export interface DirectOrderPlan {
  signalId: string;
  instrument: string;
  direction: "long" | "short" | string;
  entryPrice: number;
  stopLoss: number;
  /** First target only — the policy manages a single exit. */
  tp1: number;
  grade: string;
  detectedAt: string;
  /**
   * How the order reaches the market. Absent ⇒ the historical pending limit.
   * `market` is only ever set by revalidation after the owner opted in and the
   * live price was proven to be inside the maximum acceptable entry.
   */
  entryMode?: "pending_limit" | "market";
}

export interface DirectOrderContext {
  /** The BROKER's own symbol, resolved from the account symbol map. */
  brokerSymbol: string;
  magic: number;
  quantity: OrderQuantity;
  /** Delivery row id, used as the order-attempt reference in the clientId. */
  deliveryId: number;
  /** The owner's automatic-order window, in minutes; bounds the order expiry. */
  windowMinutes?: number;
}

export class DirectOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectOrderError";
  }
}

export function marketActionTypeFor(direction: string): MarketOrderActionType {
  if (direction === "long") return "ORDER_TYPE_BUY";
  if (direction === "short") return "ORDER_TYPE_SELL";
  throw new DirectOrderError(`unsupported direction ${direction}`);
}

export function actionTypeFor(direction: string): PendingOrderActionType {
  if (direction === "long") return "ORDER_TYPE_BUY_LIMIT";
  if (direction === "short") return "ORDER_TYPE_SELL_LIMIT";
  throw new DirectOrderError(`unsupported direction ${direction}`);
}

/**
 * Expiry instant: measured from DETECTION, using the owner's automatic-order
 * window so the pending order can never outlive the window they configured.
 */
export function orderExpiry(detectedAt: string, windowMinutes: number = ORDER_TIF_MINUTES): string {
  const detected = Date.parse(detectedAt);
  if (!Number.isFinite(detected)) throw new DirectOrderError("plan has no valid detection time");
  const minutes = clampAutoOrderWindowMinutes(windowMinutes);
  if (minutes <= 0) throw new DirectOrderError("the automatic-order window is 0 minutes");
  return new Date(detected + minutes * 60_000).toISOString();
}

function finite(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new DirectOrderError(`${name} is not a usable price`);
  }
  return value;
}

/**
 * Build the pending order. Stop loss and take profit are ALWAYS present, so an
 * accepted order can never sit at the broker unprotected. Geometry that
 * contradicts the direction is refused rather than corrected.
 */
export function buildDirectOrder(
  plan: DirectOrderPlan,
  ctx: DirectOrderContext,
): PendingOrderRequest {
  const actionType = actionTypeFor(plan.direction);
  const openPrice = finite(plan.entryPrice, "entry");
  const stopLoss = finite(plan.stopLoss, "stop loss");
  const takeProfit = finite(plan.tp1, "first target");

  if (plan.direction === "long" && !(stopLoss < openPrice && takeProfit > openPrice)) {
    throw new DirectOrderError("long geometry requires stop below entry and target above entry");
  }
  if (plan.direction === "short" && !(stopLoss > openPrice && takeProfit < openPrice)) {
    throw new DirectOrderError("short geometry requires stop above entry and target below entry");
  }

  const volume = ctx.quantity.lots;
  if (typeof volume !== "number" || !Number.isFinite(volume) || volume <= 0) {
    throw new DirectOrderError("no authoritative position quantity");
  }

  const symbol = ctx.brokerSymbol.trim();
  if (!symbol) throw new DirectOrderError("no broker symbol resolved for this instrument");

  if (!Number.isInteger(ctx.magic) || ctx.magic <= 0) {
    throw new DirectOrderError("no magic number assigned to this account");
  }

  return {
    actionType,
    symbol,
    volume,
    openPrice,
    stopLoss,
    takeProfit,
    expirationTime: orderExpiry(plan.detectedAt, ctx.windowMinutes ?? ORDER_TIF_MINUTES),
    clientId: buildClientId({
      strategyId: PTRADES_STRATEGY_ID,
      positionRef: plan.signalId,
      orderRef: String(ctx.deliveryId),
    }),
    magic: ctx.magic,
    // MetaApi documents a combined 26-character budget for comment + clientId.
    // The clientId is the reconciliation/ownership key, so it receives the
    // whole budget and the optional cosmetic comment is intentionally omitted.
  };
}

/**
 * Build a MARKET order. Same protection contract as the pending path — stop loss
 * and first target are always attached — but with no resting price and no
 * expiration: it fills now or the broker refuses it. `plan.entryPrice` here is
 * the live price revalidation already proved is inside the maximum acceptable
 * entry, and is what the geometry and the quantity were derived from.
 */
export function buildDirectMarketOrder(
  plan: DirectOrderPlan,
  ctx: DirectOrderContext,
): MarketOrderRequest {
  const actionType = marketActionTypeFor(plan.direction);
  const reference = finite(plan.entryPrice, "entry");
  const stopLoss = finite(plan.stopLoss, "stop loss");
  const takeProfit = finite(plan.tp1, "first target");

  if (plan.direction === "long" && !(stopLoss < reference && takeProfit > reference)) {
    throw new DirectOrderError("long geometry requires stop below entry and target above entry");
  }
  if (plan.direction === "short" && !(stopLoss > reference && takeProfit < reference)) {
    throw new DirectOrderError("short geometry requires stop above entry and target below entry");
  }

  const volume = ctx.quantity.lots;
  if (typeof volume !== "number" || !Number.isFinite(volume) || volume <= 0) {
    throw new DirectOrderError("no authoritative position quantity");
  }
  const symbol = ctx.brokerSymbol.trim();
  if (!symbol) throw new DirectOrderError("no broker symbol resolved for this instrument");
  if (!Number.isInteger(ctx.magic) || ctx.magic <= 0) {
    throw new DirectOrderError("no magic number assigned to this account");
  }

  return {
    actionType,
    symbol,
    volume,
    stopLoss,
    takeProfit,
    clientId: buildClientId({
      strategyId: PTRADES_STRATEGY_ID,
      positionRef: plan.signalId,
      orderRef: String(ctx.deliveryId),
    }),
    magic: ctx.magic,
  };
}

export type MarginVerdict = { ok: true } | { ok: false; detail: string };

/**
 * Broker-authoritative margin gate.
 *
 * The broker's own `calculate-margin` answer is the only accepted input. When
 * the broker does not answer we REFUSE rather than estimate: a locally invented
 * margin figure must never authorise a real order.
 */
export const MAX_MARGIN_FRACTION_OF_FREE_MARGIN = 0.5;

export function marginAcceptable(
  brokerMargin: number | null,
  freeMargin: number | null,
): MarginVerdict {
  if (brokerMargin === null || !Number.isFinite(brokerMargin) || brokerMargin < 0) {
    return { ok: false, detail: "the broker did not return a margin estimate for this order" };
  }
  if (freeMargin === null || !Number.isFinite(freeMargin)) {
    return { ok: false, detail: "the broker did not report free margin for this account" };
  }
  if (brokerMargin > freeMargin * MAX_MARGIN_FRACTION_OF_FREE_MARGIN) {
    return {
      ok: false,
      detail: `broker margin ${brokerMargin} exceeds ${Math.round(
        MAX_MARGIN_FRACTION_OF_FREE_MARGIN * 100,
      )}% of free margin ${freeMargin}`,
    };
  }
  return { ok: true };
}

/**
 * Map a broker verdict onto a delivery state.
 *
 * `unknown` stays `unknown` — a submission whose outcome we cannot prove may
 * already exist at the broker, and Stage 4 reconciliation, not a retry, is what
 * resolves it.
 */
export function deliveryStateForVerdict(verdict: TradeVerdict): DeliveryState {
  if (verdict.outcome === "accepted") return "acknowledged";
  if (verdict.outcome === "rejected") return "rejected";
  return "unknown";
}
