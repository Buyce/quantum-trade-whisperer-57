/**
 * Pure execution-plane vocabulary: delivery states, rejection reasons, the
 * named order policy, and the bridge order derived from a published setup.
 *
 * Deliberately free of Supabase, fetch, clocks and env so every financial rule
 * here is deterministic and unit-testable. Nothing in this module — and nothing
 * that imports it — may be reachable from the scanner pipeline: delivery can
 * never influence publication, eligibility, shadow enrolment or any statistic.
 */
import { ORDER_TIF_MINUTES, type Direction, type Grade } from "@/lib/db-types";

export type DeliveryState =
  | "pending"
  | "claimed"
  | "sent"
  | "acknowledged"
  | "rejected"
  | "unknown"
  | "failed";

/**
 * Only `pending` is claimable. A `sent` or `unknown` row is NEVER re-attempted:
 * an unacknowledged POST may already have created a broker order, so an
 * automatic retry is how a bridge double-fires. Resolution is human/dry-run.
 */
export function isClaimable(state: DeliveryState): boolean {
  return state === "pending";
}

export function isTerminal(state: DeliveryState): boolean {
  return state !== "pending" && state !== "claimed";
}

/**
 * Named execution policy. The bridge places ONE order that exits at the first
 * target — exactly the object the shadow replay registry measures under
 * `single_exit_first_target`. TP2/TP3 are shown to the trader but are NOT
 * managed by the bridge; inventing a third, unmeasured multi-exit behaviour
 * would mean the bridge result and the engine's statistics describe different
 * strategies.
 */
export type ExecutionPolicy = "single_exit_first_target";
export const DEFAULT_EXECUTION_POLICY: ExecutionPolicy = "single_exit_first_target";

export const EXECUTION_POLICY_NOTE =
  "One pending order, single exit at the first target. TP2 and TP3 are not managed by the bridge.";

export type RejectReason =
  | "live_execution_globally_disabled"
  | "user_execution_disabled"
  | "bridge_disabled"
  | "instrument_disabled"
  | "webhook_not_configured"
  | "webhook_not_validated"
  | "endpoint_rejected"
  | "not_alert_eligible"
  | "signal_missing"
  | "signal_not_active"
  | "tif_expired"
  | "quote_unavailable"
  | "quote_stale"
  | "spread_too_wide"
  | "price_beyond_max_acceptable_entry"
  | "market_closed"
  | "stop_below_broker_stops_level"
  | "risk_guardrail"
  | "exposure_guardrail"
  | "host_not_allowlisted"
  | "policy_unsupported";

export const REJECT_COPY: Record<RejectReason, string> = {
  live_execution_globally_disabled: "Live execution is disabled system-wide.",
  user_execution_disabled: "You have not enabled execution for your account.",
  bridge_disabled: "This bridge profile is temporarily disabled.",
  instrument_disabled: "Execution is temporarily disabled for this instrument.",
  webhook_not_configured: "No bridge URL is saved.",
  webhook_not_validated: "Your bridge URL has not passed endpoint validation.",
  endpoint_rejected: "Your bridge URL failed endpoint validation at send time.",
  not_alert_eligible: "This setup is not eligible for your alert channel.",
  signal_missing: "The setup no longer exists.",
  signal_not_active: "The setup is no longer active.",
  tif_expired: `The setup passed its ${ORDER_TIF_MINUTES}-minute time-in-force before dispatch.`,
  quote_unavailable: "No broker price was available to revalidate the setup.",
  quote_stale: "The broker price was too old to revalidate the setup.",
  spread_too_wide: "The spread was too wide relative to the planned risk.",
  price_beyond_max_acceptable_entry:
    "Price had already run beyond the maximum acceptable entry.",
  market_closed: "The market was closed.",
  stop_below_broker_stops_level: "The stop is closer than your broker's minimum stop distance.",
  risk_guardrail: "A position-size guardrail blocked the order.",
  exposure_guardrail: "An advisory exposure limit blocked the order.",
  policy_unsupported: "The configured execution policy is not supported.",
};

/** Spread may not consume more than this share of the planned stop distance. */
export const MAX_SPREAD_FRACTION_OF_RISK = 0.15;

/** Revalidation refuses any broker price older than this. */
export const REVALIDATION_QUOTE_MAX_AGE_MS = 90_000;

export interface BridgeSignal {
  id: string;
  instrument: string;
  grade: Grade | string;
  direction: Direction | string;
  entryPrice: number;
  maxAcceptableEntry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number | null;
  rrRatio: number;
  confidence: number;
}

export interface BridgeOrder {
  signalId: string;
  instrument: string;
  /** Always a LIMIT: after a break the only order MT5 accepts back at the
   *  structural entry is a plain limit — never a stop or stop-limit. */
  action: "buy_limit" | "sell_limit";
  entry: number;
  maxAcceptableEntry: number;
  stopLoss: number;
  /** Single exit under `single_exit_first_target`. */
  takeProfit: number;
  expiresInMinutes: number;
  policy: ExecutionPolicy;
  grade: string;
  rr: number;
  confidence: number;
}

export function buildBridgeOrder(
  signal: BridgeSignal,
  policy: ExecutionPolicy = DEFAULT_EXECUTION_POLICY,
): BridgeOrder {
  if (policy !== "single_exit_first_target") {
    throw new Error(`unsupported execution policy: ${String(policy)}`);
  }
  return {
    signalId: signal.id,
    instrument: signal.instrument,
    action: signal.direction === "long" ? "buy_limit" : "sell_limit",
    entry: signal.entryPrice,
    maxAcceptableEntry: signal.maxAcceptableEntry,
    stopLoss: signal.stopLoss,
    takeProfit: signal.tp1,
    expiresInMinutes: ORDER_TIF_MINUTES,
    policy,
    grade: String(signal.grade),
    rr: signal.rrRatio,
    confidence: signal.confidence,
  };
}

/**
 * True when the live broker price is still on the tradable side of the slippage
 * ceiling. Beyond it the payoff the grade was based on no longer holds, so the
 * order is rejected rather than slipped in.
 */
export function withinMaxAcceptableEntry(
  order: Pick<BridgeOrder, "action" | "maxAcceptableEntry">,
  price: number,
): boolean {
  return order.action === "buy_limit"
    ? price <= order.maxAcceptableEntry
    : price >= order.maxAcceptableEntry;
}

export function spreadAcceptable(
  order: Pick<BridgeOrder, "entry" | "stopLoss">,
  bid: number,
  ask: number,
): boolean {
  const risk = Math.abs(order.entry - order.stopLoss);
  if (!(risk > 0)) return false;
  const spread = Math.abs(ask - bid);
  return spread <= risk * MAX_SPREAD_FRACTION_OF_RISK;
}
