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
import { INSTRUMENT_NOT_APPROVED } from "@/lib/instruments/lifecycle";
import { assertCapability } from "@/lib/instruments/lifecycle.server";
import { fetchAccountFacts, fetchOrders, fetchPositions } from "@/lib/metaapi/accounts.server";
import { fetchQuoteFor, type BrokerQuote } from "@/lib/metaapi/market.server";
import { estimateMargin } from "@/lib/metaapi/margin.server";
import { submitMarketOrder, submitPendingOrder } from "@/lib/metaapi/trade.server";
import type { AccountMode } from "@/lib/accounts/types";
import type { AccountType } from "@/lib/metaapi/classify";
import type { OrderQuantity } from "@/lib/delivery/execution";
import { materialEquityChange } from "./equity-freshness";
import { evaluateAccountExposure } from "./exposure-account";
import {
  buildDirectMarketOrder,
  buildDirectOrder,
  marketActionTypeFor,
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
  /** Broker-reported equity, used as the AUTHORITATIVE sizing equity. */
  equity: number | null;
  /** Broker-reported deposit currency of this account. */
  currency: string | null;
  /** When the broker reported the figures above. */
  observedAt: string | null;
  /**
   * Operator/trader-configured ACCOUNT-WIDE broker exposure boundary: the maximum
   * number of broker-side positions + pending orders this account may carry,
   * counting the one about to be submitted. Null ⇒ no boundary configured.
   */
  maxAccountOpenPositions?: number | null;
  /** System-wide mode gates, carried so the pre-submit refresh can re-apply them. */
  globalDemoAuto: boolean;
  globalLiveAuto: boolean;
  globalLiveConfirm?: boolean;
  ownerConfirmed?: boolean;
}

export type DirectTargetResult = { ok: true; target: DirectTarget } | { ok: false; detail: string };

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
  broker_equity: number | null;
  account_currency: string | null;
  broker_observed_at: string | null;
  max_account_open_positions: number | null;
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
    /** Per-order live confirmation capability, system-wide. Default OFF. */
    globalLiveConfirm?: boolean;
    /** Whether THIS delivery carries a valid owner confirmation. */
    ownerConfirmed?: boolean;
  },
): Promise<DirectTargetResult> {
  const { data } = await db
    .from("connected_trading_accounts")
    .select(
      "id, metaapi_account_id, region, magic, mode, phase, intent_conflict, trade_allowed, investor_mode, broker_account_type, broker_free_margin, broker_equity, account_currency, broker_observed_at, max_account_open_positions, disconnected_at",
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
    globalLiveConfirm: input.globalLiveConfirm === true,
    ownerConfirmed: input.ownerConfirmed === true,
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
  const mapped = mapRow as {
    broker_symbol: string | null;
    mapping_kind: string;
    candidates: string[] | null;
  } | null;

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
      freeMargin: account.broker_free_margin === null ? null : Number(account.broker_free_margin),
      accountType: account.broker_account_type,
      equity: account.broker_equity === null ? null : Number(account.broker_equity),
      currency: account.account_currency,
      observedAt: account.broker_observed_at,
      maxAccountOpenPositions:
        account.max_account_open_positions === null
          ? null
          : Number(account.max_account_open_positions),

      globalDemoAuto: input.globalDemoAuto,
      globalLiveAuto: input.globalLiveAuto,
      globalLiveConfirm: input.globalLiveConfirm === true,
      ownerConfirmed: input.ownerConfirmed === true,
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
  resize?: DirectResizer,
  /** The owner's automatic-order window; bounds the pending order's expiry. */
  windowMinutes?: number,
): Promise<DirectSubmitResult> {
  // ---- Pre-submission safety refresh + FINAL sizing ------------------------
  // Everything the earlier revalidation read can change in the meantime: an
  // account can be switched to investor-only, have trading disabled, be
  // converted, lose free margin — or simply hold different equity. The broker is
  // asked ONE more time here, and the volume that goes on the order is derived
  // from THAT answer, never from the earlier snapshot.
  const refreshed = await refreshAccountSafety(db, target);
  if (!refreshed.ok) {
    await settle(db, delivery.id, {
      destination_type: "metaapi_direct",
      account_mode: target.mode,
      state: "rejected",
      reason: `pre_submit_safety: ${refreshed.detail}`,
      settled_at: new Date().toISOString(),
    });
    return { state: "rejected", reason: refreshed.detail, brokerOrderId: null };
  }
  const freeMargin = refreshed.freeMargin;

  let finalQuantity = quantity;
  // Risk stays null unless a sizing run actually produced it; an unknown figure
  // is stored as unknown so the exposure ceiling can say so honestly.
  let finalRisk: {
    amount: number | null;
    currency: string | null;
    percentOfEquity: number | null;
  } = {
    amount: null,
    currency: null,
    percentOfEquity: null,
  };
  if (resize) {
    const resized = await resize({
      equity: refreshed.equity,
      currency: refreshed.currency,
      observedAt: refreshed.observedAt,
    });
    if (!resized.ok) {
      await settle(db, delivery.id, {
        destination_type: "metaapi_direct",
        account_mode: target.mode,
        state: "rejected",
        reason: `pre_submit_sizing: ${resized.reason}: ${resized.detail}`,
        settled_at: new Date().toISOString(),
      });
      return { state: "rejected", reason: resized.detail, brokerOrderId: null };
    }
    finalQuantity = resized.quantity;
    if (resized.risk) finalRisk = resized.risk;
  } else {
    // No resizer: the quantity was authorized from an EARLIER equity figure, so
    // it may only be submitted while that figure still describes the account.
    // A material move refuses rather than sending a size the trader never chose.
    const moved = materialEquityChange(target.equity, refreshed.equity);
    if (moved.material) {
      await settle(db, delivery.id, {
        destination_type: "metaapi_direct",
        account_mode: target.mode,
        state: "rejected",
        reason: `pre_submit_sizing: equity_moved: ${moved.detail}`,
        settled_at: new Date().toISOString(),
      });
      return { state: "rejected", reason: moved.detail, brokerOrderId: null };
    }
  }

  // Opt-in market entry: no resting price, no expiration. Everything else — the
  // gates above, the margin gate, the settlement record — is identical.
  const marketEntry = plan.entryMode === "market";
  let order;
  try {
    const ctx = {
      brokerSymbol: target.brokerSymbol,
      magic: target.magic,
      quantity: finalQuantity,
      deliveryId: delivery.id,
      ...(windowMinutes === undefined ? {} : { windowMinutes }),
    };
    order = marketEntry ? buildDirectMarketOrder(plan, ctx) : buildDirectOrder(plan, ctx);
  } catch (err) {
    const detail =
      err instanceof DirectOrderError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
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
    entry_mode: marketEntry ? "market" : "pending_limit",
    client_id: order.clientId,
    magic: order.magic,
    broker_symbol: order.symbol,
    submitted_volume: order.volume,
    risk_amount: finalRisk.amount,
    risk_currency: finalRisk.currency,
    risk_percent_of_equity: finalRisk.percentOfEquity,
    submitted_entry: "openPrice" in order ? order.openPrice : plan.entryPrice,
    submitted_stop: order.stopLoss,
    submitted_target: order.takeProfit,
  };

  // ---- Broker-authoritative margin gate ------------------------------------
  let brokerMargin: number | null = null;
  try {
    brokerMargin = await estimateMargin(target.metaapiAccountId, target.region, {
      symbol: order.symbol,
      // MetaApi's calculate-margin endpoint only accepts the plain BUY/SELL
      // action types; sending ORDER_TYPE_BUY_LIMIT is answered with HTTP 400,
      // which the gate then reads as "no margin estimate" and refuses a valid
      // order. Margin for a pending limit at its open price equals margin for
      // the same side and volume, so the market action type is used here for
      // both entry modes. The resting order itself is unchanged.
      type: marketActionTypeFor(plan.direction),
      volume: order.volume,
      openPrice: "openPrice" in order ? order.openPrice : plan.entryPrice,
    });
  } catch {
    brokerMargin = null;
  }
  const marginGate = marginAcceptable(brokerMargin, freeMargin);
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
      reason: `dry_run: validated against the broker, no order submitted (${
        marketEntry ? "market entry" : "pending limit"
      })`,
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

  /**
   * Final lifecycle read at the broker boundary (Phase A2A, R3-FIX).
   *
   * Revalidation, account refresh, final sizing and margin estimation all happened
   * before this point. A suspension issued inside that window must still prevent
   * the MetaApi call. The `sent` evidence remains as the immutable attempt
   * boundary, but no broker request is made when this last read refuses.
   */
  const finalGate = await assertCapability(
    db as unknown as SupabaseClient,
    plan.instrument,
    "execute",
  );
  if (!finalGate.allowed) {
    const reason = `${INSTRUMENT_NOT_APPROVED}: ${
      finalGate.reason ?? `${plan.instrument} is not approved for execution`
    }`;
    await settle(db, delivery.id, {
      state: "rejected",
      reason,
      settled_at: new Date().toISOString(),
    });
    return { state: "rejected", reason, brokerOrderId: null };
  }

  let verdict;
  try {
    verdict =
      marketEntry && !("openPrice" in order)
        ? await submitMarketOrder(target.metaapiAccountId, target.region, order)
        : await submitPendingOrder(
            target.metaapiAccountId,
            target.region,
            order as Parameters<typeof submitPendingOrder>[2],
          );
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

export interface SafetyRefresh {
  ok: true;
  freeMargin: number | null;
  /** The equity the broker reports RIGHT NOW; the only basis for the volume. */
  equity: number | null;
  /** The deposit currency the broker reports right now. Never assumed. */
  currency: string | null;
  /** When the broker observed the figures above. */
  observedAt: string | null;
}

export type DirectPreflight =
  | { ok: true; target: DirectTarget; quote: BrokerQuote }
  | { ok: false; reason: "account_refresh_unavailable" | "quote_unavailable"; detail: string };

/**
 * Fetch the two independent broker facts required before a direct order can be
 * sized: current account information and the destination account's own quote.
 * Neither stored equity nor the benchmark account is a fallback.
 */
export async function refreshDirectPreflight(
  db: Db,
  target: DirectTarget,
): Promise<DirectPreflight> {
  const [accountResult, quoteResult] = await Promise.allSettled([
    refreshAccountSafety(db, target),
    fetchQuoteFor(target.metaapiAccountId, target.region, target.brokerSymbol),
  ]);
  if (accountResult.status === "rejected") {
    return {
      ok: false,
      reason: "account_refresh_unavailable",
      detail:
        accountResult.reason instanceof Error
          ? accountResult.reason.message
          : String(accountResult.reason),
    };
  }
  if (!accountResult.value.ok) {
    return {
      ok: false,
      reason: "account_refresh_unavailable",
      detail: accountResult.value.detail,
    };
  }
  if (quoteResult.status === "rejected") {
    return {
      ok: false,
      reason: "quote_unavailable",
      detail:
        quoteResult.reason instanceof Error
          ? quoteResult.reason.message
          : String(quoteResult.reason),
    };
  }
  if (!quoteResult.value) {
    return { ok: false, reason: "quote_unavailable", detail: "broker returned no price" };
  }
  return {
    ok: true,
    target: {
      ...target,
      freeMargin: accountResult.value.freeMargin,
      equity: accountResult.value.equity,
      currency: accountResult.value.currency,
      observedAt: accountResult.value.observedAt,
    },
    quote: quoteResult.value,
  };
}

/**
 * Derives the FINAL order quantity from the pre-submit broker snapshot. Supplied
 * by the dispatcher; absent only in tests that assert the gates themselves.
 */
export type DirectResizer = (snapshot: {
  equity: number | null;
  currency: string | null;
  observedAt: string | null;
}) => Promise<
  | {
      ok: true;
      quantity: OrderQuantity;
      /** Broker-derived risk behind this volume; null where it is unknown. */
      risk?: { amount: number | null; currency: string | null; percentOfEquity: number | null };
    }
  | { ok: false; reason: string; detail: string }
>;

/**
 * Re-read the destination account from the BROKER and re-apply every Stage-3
 * gate. Fails closed: no answer, a changed account type, investor mode, trading
 * disabled or a conflicted connection all refuse.
 */
export async function refreshAccountSafety(
  db: Db,
  target: DirectTarget,
): Promise<SafetyRefresh | { ok: false; detail: string }> {
  let facts;
  try {
    facts = await fetchAccountFacts(target.metaapiAccountId, target.region);
  } catch (err) {
    return {
      ok: false,
      detail: `your broker could not be reached to re-check the account (${err instanceof Error ? err.message : String(err)})`,
    };
  }
  if (!facts) return { ok: false, detail: "your broker returned no account information" };

  const info = facts.info as {
    tradeAllowed?: boolean | null;
    investorMode?: boolean | null;
    freeMargin?: number | null;
    equity?: number | null;
    balance?: number | null;
    currency?: string | null;
  };
  const freeMargin =
    typeof info.freeMargin === "number" && Number.isFinite(info.freeMargin)
      ? info.freeMargin
      : null;

  // Persist the fresh broker facts: the account screen must not keep showing
  // figures that were already superseded at submission time.
  await db
    .from("connected_trading_accounts")
    .update({
      broker_account_type: facts.type,
      trade_allowed: info.tradeAllowed ?? null,
      investor_mode: typeof info.investorMode === "boolean" ? info.investorMode : null,
      broker_free_margin: freeMargin,
      broker_equity: typeof info.equity === "number" ? info.equity : null,
      ...(typeof info.currency === "string" && info.currency.trim()
        ? { account_currency: info.currency.trim() }
        : {}),
      broker_observed_at: facts.observedAt,
    } as never)
    .eq("id", target.accountId);

  if (facts.type !== target.accountType) {
    return {
      ok: false,
      detail: `your broker now reports this account as ${facts.type.toUpperCase()}, not ${target.accountType.toUpperCase()}`,
    };
  }

  const gate = directExecutionAllowed({
    mode: target.mode,
    brokerAccountType: facts.type,
    tradeAllowed: info.tradeAllowed ?? null,
    investorMode: typeof info.investorMode === "boolean" ? info.investorMode : null,
    ready: true,
    intentConflict: false,
    globalDemoAuto: target.globalDemoAuto,
    globalLiveAuto: target.globalLiveAuto,
    globalLiveConfirm: target.globalLiveConfirm === true,
    ownerConfirmed: target.ownerConfirmed === true,
  });
  if (!gate.ok) return { ok: false, detail: gate.detail };

  if (freeMargin === null) {
    return { ok: false, detail: "your broker did not report free margin for this account" };
  }

  const equity =
    typeof info.equity === "number" && Number.isFinite(info.equity) ? info.equity : null;
  const observedAt = facts.observedAt ?? null;

  // Equity freshness is enforced where the equity is actually CONSUMED, in
  // `resolveSizingForAccount`, which owns the injected clock and the
  // `equityAsOf` provenance. Re-checking it here against wall-clock time would
  // only re-measure our own receipt instant.

  // ---- Account-wide BROKER exposure boundary --------------------------------
  // This is broker-derived, not the journal advisory, and it counts everything on
  // the account including the trader's own manual trades. Fail-closed: if the
  // broker's positions or orders cannot be read, no order is added.
  const exposure = await evaluateBrokerExposure(target);
  if (!exposure.allowed) return { ok: false, detail: exposure.detail };

  return {
    ok: true,
    freeMargin,
    equity,
    currency:
      typeof info.currency === "string" && info.currency.trim() ? info.currency.trim() : null,
    observedAt,
  };
}

/**
 * Read what the broker currently carries on this account and apply the
 * configured boundary. Separated so the pure rules in `./exposure-account` stay
 * testable without any network.
 */
async function evaluateBrokerExposure(
  target: DirectTarget,
): Promise<{ allowed: true } | { allowed: false; detail: string }> {
  // No boundary configured is a legitimate configuration, and reading the broker
  // for it would spend a request to reach a decision that cannot change.
  const limit = target.maxAccountOpenPositions ?? null;
  if (limit === null) return { allowed: true };

  let openPositions = 0;
  let pendingOrders = 0;
  let unreadableReason: string | null = null;
  try {
    const [positions, orders] = await Promise.all([
      fetchPositions(target.metaapiAccountId, target.region),
      fetchOrders(target.metaapiAccountId, target.region),
    ]);
    openPositions = positions.length;
    pendingOrders = orders.length;
  } catch (err) {
    unreadableReason = `your broker's open positions could not be read (${err instanceof Error ? err.message : String(err)}), so P-Trades will not add another order`;
  }

  const verdict = evaluateAccountExposure(
    {
      readable: unreadableReason === null,
      unreadableReason,
      openPositions,
      pendingOrders,
    },
    { maxAccountOpenPositions: limit },
  );
  return verdict.allowed ? { allowed: true } : { allowed: false, detail: verdict.detail };
}

async function settle(db: Db, id: number, patch: Record<string, unknown>): Promise<void> {
  const { error } = await db
    .from("execution_deliveries")
    .update(patch as never)
    .eq("id", id);
  if (error) console.error("[direct] settle failed", { id, error: error.message });
}
