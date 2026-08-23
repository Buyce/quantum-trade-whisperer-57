/**
 * Prompt 14 Stage 3 — the SERVER half of direct broker execution.
 *
 * Two responsibilities, deliberately separated:
 *
 *  1. `loadDirectTarget` — resolve and gate the destination account: broker
 *     facts, armed mode, system-wide mode gate, and the BROKER's own symbol for
 *     the instrument. Any unknown refuses.
 *  2. `submitDirectOrder` — the one-submit path: broker margin gate, then a
 *     single `trade` submission, then settlement of the delivery row from the
 *     broker's own verdict.
 *
 * Stage-3 isolation: nothing here can throw into the scanner, the shadow replay
 * engine or any statistic. Failures settle a delivery row and stop.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { isMappingUsable, mapSymbol } from "@/lib/accounts/symbol-map";
import { estimateMargin } from "@/lib/metaapi/margin.server";
import { submitPendingOrder } from "@/lib/metaapi/trade.server";
import type { AccountMode } from "@/lib/accounts/types";
import type { AccountType } from "@/lib/metaapi/classify";
import type { OrderQuantity } from "@/lib/delivery/execution";
import {
  buildDirectOrder,
  deliveryStateForVerdict,
  directExecutionAllowed,
  DirectOrderError,
  marginAcceptable,
  type DirectOrderPlan,
} from "./direct";

type Db = Pick<SupabaseClient, "from" | "rpc">;

export interface DirectTarget {
  accountId: string;
  metaapiAccountId: string;
  region: string;
  magic: number;
  mode: AccountMode;
  brokerSymbol: string;
  freeMargin: number | null;
  accountType: AccountType;
}

export type DirectTargetResult =
  | { ok: true; target: DirectTarget }
  | { ok: false; detail: string };

interface AccountRow {
  id: string;
  metaapi_account_id: string | null;
  region: string;
  magic: number | null;
  mode: AccountMode;
  phase: string;
  intent_conflict: boolean;
  trade_allowed: boolean | null;
  investor_mode: boolean | null;
  broker_account_type: AccountType;
  broker_free_margin: number | null;
  disconnected_at: string | null;
}

/**
 * Resolve the destination account and prove it may be traded right now.
 *
 * The broker symbol comes from the account's own resolved symbol map, or — when
 * no row exists yet — from the specifications actually fetched for that account.
 * An unmapped or ambiguous instrument refuses: a symbol name is never guessed.
 */
export async function loadDirectTarget(
  db: Db,
  input: {
    connectedAccountId: string;
    userId: string;
    instrument: string;
    globalDemoAuto: boolean;
    globalLiveAuto: boolean;
  },
): Promise<DirectTargetResult> {
  const { data } = await db
    .from("connected_trading_accounts")
    .select(
      "id, metaapi_account_id, region, magic, mode, phase, intent_conflict, trade_allowed, investor_mode, broker_account_type, broker_free_margin, disconnected_at",
    )
    .eq("id", input.connectedAccountId)
    .eq("user_id", input.userId)
    .maybeSingle();
  const account = data as AccountRow | null;
  if (!account) return { ok: false, detail: "the destination account no longer exists" };
  if (account.disconnected_at) return { ok: false, detail: "the account has been disconnected" };
  if (!account.metaapi_account_id) {
    return { ok: false, detail: "the account has no broker connection id" };
  }

  const gate = directExecutionAllowed({
    mode: account.mode,
    brokerAccountType: account.broker_account_type,
    tradeAllowed: account.trade_allowed,
    investorMode: account.investor_mode,
    ready: account.phase === "connected" || account.phase === "ready",
    intentConflict: account.intent_conflict,
    globalDemoAuto: input.globalDemoAuto,
    globalLiveAuto: input.globalLiveAuto,
  });
  if (!gate.ok) return { ok: false, detail: gate.detail };

  if (!Number.isInteger(account.magic) || (account.magic ?? 0) <= 0) {
    return { ok: false, detail: "the account has no magic number assigned" };
  }

  const { data: mapRow } = await db
    .from("connected_account_symbols")
    .select("broker_symbol, mapping_kind, candidates")
    .eq("account_id", account.id)
    .eq("canonical_symbol", input.instrument)
    .maybeSingle();
  const mapped = mapRow as
    | { broker_symbol: string | null; mapping_kind: string; candidates: string[] | null }
    | null;

  let brokerSymbol: string | null = null;
  if (mapped && mapped.mapping_kind !== "ambiguous" && mapped.broker_symbol) {
    brokerSymbol = mapped.broker_symbol;
  } else if (mapped?.candidates?.length) {
    // Re-run the pure resolver over the recorded candidates; still refuses when
    // more than one broker symbol could plausibly be the instrument.
    const mapping = mapSymbol(input.instrument, mapped.candidates);
    if (isMappingUsable(mapping) && mapping.brokerSymbol) brokerSymbol = mapping.brokerSymbol;
  }
  if (!brokerSymbol) {
    return {
      ok: false,
      detail: `no unambiguous broker symbol is resolved for ${input.instrument} on this account`,
    };
  }

  return {
    ok: true,
    target: {
      accountId: account.id,
      metaapiAccountId: account.metaapi_account_id,
      region: account.region,
      magic: account.magic as number,
      mode: account.mode,
      brokerSymbol,
      freeMargin:
        account.broker_free_margin === null ? null : Number(account.broker_free_margin),
      accountType: account.broker_account_type,
    },
  };
}

export interface DirectSubmitResult {
  state: "acknowledged" | "rejected" | "unknown";
  reason: string | null;
  brokerOrderId: string | null;
}

/**
 * THE one-submit path. Called at most once per (account, signal) — the database
 * makes a second delivery row impossible — and it never retries internally.
 */
export async function submitDirectOrder(
  db: Db,
  delivery: { id: number; dry_run: boolean },
  plan: DirectOrderPlan,
  quantity: OrderQuantity,
  target: DirectTarget,
): Promise<DirectSubmitResult> {
  let order;
  try {
    order = buildDirectOrder(plan, {
      brokerSymbol: target.brokerSymbol,
      magic: target.magic,
      quantity,
      deliveryId: delivery.id,
    });
  } catch (err) {
    const detail =
      err instanceof DirectOrderError ? err.message : err instanceof Error ? err.message : String(err);
    await settle(db, delivery.id, {
      state: "rejected",
      reason: `order_not_constructible: ${detail}`,
      settled_at: new Date().toISOString(),
    });
    return { state: "rejected", reason: detail, brokerOrderId: null };
  }

  const common = {
    destination_type: "metaapi_direct",
    account_mode: target.mode,
    client_id: order.clientId,
    magic: order.magic,
    broker_symbol: order.symbol,
    submitted_volume: order.volume,
    submitted_entry: order.openPrice,
    submitted_stop: order.stopLoss,
    submitted_target: order.takeProfit,
  };

  // ---- Broker-authoritative margin gate ------------------------------------
  let brokerMargin: number | null = null;
  try {
    brokerMargin = await estimateMargin(target.metaapiAccountId, target.region, {
      symbol: order.symbol,
      type: order.actionType,
      volume: order.volume,
      openPrice: order.openPrice,
    });
  } catch {
    brokerMargin = null;
  }
  const marginGate = marginAcceptable(brokerMargin, target.freeMargin);
  if (!marginGate.ok) {
    await settle(db, delivery.id, {
      ...common,
      state: "rejected",
      reason: `margin_gate: ${marginGate.detail}`,
      margin_estimate: brokerMargin,
      settled_at: new Date().toISOString(),
    });
    return { state: "rejected", reason: marginGate.detail, brokerOrderId: null };
  }

  if (delivery.dry_run) {
    // The full pipeline ran — gates, symbol resolution, geometry, quantity,
    // broker margin — and NOTHING was submitted.
    await settle(db, delivery.id, {
      ...common,
      state: "acknowledged",
      reason: "dry_run: validated against the broker, no order submitted",
      margin_estimate: brokerMargin,
      settled_at: new Date().toISOString(),
    });
    return { state: "acknowledged", reason: "dry_run", brokerOrderId: null };
  }

  // Record the submission BEFORE it happens. The row can never be re-claimed,
  // so a process death mid-flight leaves evidence rather than a silent gap.
  await settle(db, delivery.id, {
    ...common,
    state: "sent",
    margin_estimate: brokerMargin,
    submitted_at: new Date().toISOString(),
    sent_at: new Date().toISOString(),
  });

  let verdict;
  try {
    verdict = await submitPendingOrder(target.metaapiAccountId, target.region, order);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Ambiguous by definition: the order may or may not exist at the broker.
    await settle(db, delivery.id, {
      state: "unknown",
      reason: `transport error after submit: ${detail}`,
      settled_at: new Date().toISOString(),
    });
    return { state: "unknown", reason: detail, brokerOrderId: null };
  }

  const state = deliveryStateForVerdict(verdict);
  await settle(db, delivery.id, {
    state,
    reason:
      state === "acknowledged"
        ? null
        : `broker ${verdict.stringCode ?? verdict.numericCode ?? "no code"}: ${verdict.message ?? "no message"}`,
    broker_order_id: verdict.orderId,
    broker_position_id: verdict.positionId,
    broker_retcode: verdict.numericCode,
    broker_retcode_string: verdict.stringCode,
    settled_at: new Date().toISOString(),
  });
  return {
    state: state as DirectSubmitResult["state"],
    reason: state === "acknowledged" ? null : (verdict.message ?? verdict.stringCode ?? null),
    brokerOrderId: verdict.orderId,
  };
}

async function settle(db: Db, id: number, patch: Record<string, unknown>): Promise<void> {
  const { error } = await db.from("execution_deliveries").update(patch as never).eq("id", id);
  if (error) console.error("[direct] settle failed", { id, error: error.message });
}
