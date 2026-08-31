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
import { validQuoteGeometry } from "@/lib/metaapi/quote";

export type DeliveryState =
  | "pending"
  | "claimed"
  | "sent"
  | "acknowledged"
  | "rejected"
  | "unknown"
  | "failed"
  /**
   * The unfilled-order timeout: the broker never turned this order into a
   * position within {@link UNFILLED_ORDER_TIMEOUT_MS}. A row that never reached
   * the broker is expired directly; a row that WAS resting at the broker may
   * only be expired after the broker CONFIRMS the cancellation. It is terminal,
   * so it stops occupying the owner's concurrent ceiling.
   */
  | "expired";

/**
 * How long an automatic order may sit unfilled before it is cleared.
 *
 * This is not the automatic-order window (which governs whether a SETUP is still
 * young enough to be ordered at all); it governs how long an ORDER already
 * queued or resting at the broker may wait for a fill before P-Trades gives the
 * slot back.
 */
export const UNFILLED_ORDER_TIMEOUT_MS = 60 * 60_000;

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
  | "limit_price_not_on_pending_side"
  | "limit_distance_unavailable"
  | "market_closed"
  | "stop_below_broker_stops_level"
  | "risk_guardrail"
  | "quantity_unavailable"
  | "exposure_guardrail"
  | "host_not_allowlisted"
  | "configuration_changed_since_enqueue"
  | "policy_unsupported"
  | "live_authorization_stale"
  | "account_spec_unavailable"
  | "account_equity_unavailable"
  | "account_equity_stale"
  | "account_refresh_unavailable"
  | "account_currency_unavailable"
  | "account_not_armed"
  | "instrument_not_approved"
  | "market_entry_not_enabled"
  | "no_execution_grid";

export const REJECT_COPY: Record<RejectReason, string> = {
  live_execution_globally_disabled: "Live execution is disabled system-wide.",
  user_execution_disabled: "You have not enabled execution for your account.",
  bridge_disabled: "This bridge profile is temporarily disabled.",
  instrument_disabled: "Execution is temporarily disabled for this instrument.",
  no_execution_grid:
    "This broker has not published a tick size for this symbol, so no order price could be placed on its grid.",
  instrument_not_approved:
    "This instrument is not approved for automatic execution yet. It is still being measured, so no order was sent.",
  webhook_not_configured: "No bridge URL is saved.",
  webhook_not_validated: "Your bridge URL has not passed endpoint validation.",
  endpoint_rejected: "Your bridge URL failed endpoint validation at send time.",
  not_alert_eligible: "This setup is not eligible for your alert channel.",
  signal_missing: "The setup no longer exists.",
  signal_not_active: "The setup is no longer active.",
  tif_expired: `The setup was older than the automatic-order window saved in your settings when dispatch reached it, so no order was sent.`,
  quote_unavailable: "No broker price was available to revalidate the setup.",
  quote_stale: "The broker price was too old to revalidate the setup.",
  spread_too_wide: "The spread was too wide relative to the planned risk.",
  price_beyond_max_acceptable_entry: "Price had already run beyond the maximum acceptable entry.",
  limit_price_not_on_pending_side:
    "The market had already reached the planned entry, so a pending limit order could not rest there at its planned price.",
  market_entry_not_enabled:
    "The market had already passed the planned entry, so a resting limit order was impossible. Entering at market is switched off in your settings, so nothing was sent.",
  limit_distance_unavailable:
    "Your broker has not published a minimum order distance for this symbol, so a pending limit price could not be validated. No distance is assumed.",
  market_closed: "The market was closed.",
  stop_below_broker_stops_level: "The stop is closer than your broker's minimum stop distance.",
  risk_guardrail: "A position-size guardrail blocked the order.",
  quantity_unavailable:
    "No valid position quantity could be established, so no order was sent. A quantity is never invented.",
  exposure_guardrail:
    "Your opt-in exposure limit, based solely on trades you logged, blocked the order.",
  host_not_allowlisted:
    "Live execution is only permitted to bridge destinations on the trusted list. Dry-run still works for this host.",
  configuration_changed_since_enqueue:
    "Your execution configuration changed after this setup was queued, so the queued order was not sent under the new authorization.",
  policy_unsupported: "The configured execution policy is not supported.",
  live_authorization_stale:
    "Your live-execution confirmation does not match the current configuration, so no live order was sent. Confirm live execution again to re-authorise it.",
  account_spec_unavailable:
    "P-Trades does not hold a recent enough contract specification for this symbol on this account, so no quantity could be established. It is re-read from your broker automatically; when your broker cannot be reached, the order is refused rather than sized from an old specification.",

  account_equity_unavailable:
    "Your broker did not report equity for this account, so the order could not be sized from the account it would land in.",
  account_equity_stale:
    "Your broker's equity reading for this account was too old to size an order from, so nothing was sent. A quantity is only ever authorised from a recent broker observation.",
  account_refresh_unavailable:
    "P-Trades could not refresh this broker account immediately before sizing, so nothing was sent. Stored equity is never used as a fallback for an automatic order.",
  account_currency_unavailable:
    "Your broker did not report the deposit currency of this account, so the order could not be sized. A currency is never assumed.",
  account_not_armed:
    "This broker account is not armed for automatic orders, or the matching system-wide switch is off.",
};

/**
 * Refusals that describe a MOMENT, not the setup.
 *
 * A quote that was missing or a second old, a spread that was briefly wide, a
 * market that had run through the planned limit — none of these say the setup is
 * unfit; they say "not right now". Those deliveries go back to `pending` and are
 * re-asked on the next dispatch pass, bounded by the owner's automatic-order
 * window (the age gate turns into a terminal `tif_expired` once it elapses) and
 * by {@link MAX_DELIVERY_ATTEMPTS}.
 *
 * Everything absent from this set is TERMINAL: a safety refusal, a configuration
 * refusal, a lifecycle refusal or an account refusal is never retried into
 * existence. A `sent` or `unknown` delivery is never retried either — that rule
 * lives in {@link isClaimable} and is unchanged.
 */
export const RETRYABLE_REJECT_REASONS: readonly RejectReason[] = [
  "quote_unavailable",
  "quote_stale",
  "spread_too_wide",
  "limit_price_not_on_pending_side",
  "price_beyond_max_acceptable_entry",
  "account_refresh_unavailable",
  "market_closed",
];

/** Hard bound on how many times one delivery may be re-asked. */
export const MAX_DELIVERY_ATTEMPTS = 120;

export function isRetryableRejection(reason: string | null | undefined): boolean {
  if (!reason) return false;
  const key = reason.split(":")[0]?.trim() ?? "";
  return (RETRYABLE_REJECT_REASONS as readonly string[]).includes(key);
}

/**
 * Live-mode destination allowlist. The Worker cannot pin the resolved address
 * onto the socket, so an arbitrary custom host is not a trustworthy live egress
 * target even after SSRF validation: DNS could rebind between validation and
 * connect. Live orders therefore only leave to hosts an operator has listed;
 * every other host is still fully exercisable in dry-run.
 *
 * An entry is either an exact hostname or a `.suffix` covering its subdomains.
 * An EMPTY allowlist means no live destination is trusted — fail closed.
 */
export function hostAllowedForLive(host: string, allowlist: readonly string[]): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!h) return false;
  return allowlist.some((raw) => {
    const entry = raw.trim().toLowerCase().replace(/\.$/, "");
    if (!entry) return false;
    return entry.startsWith(".") ? h.endsWith(entry) : h === entry;
  });
}

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

/**
 * The position quantity actually authorized for this order, together with the
 * sizing provenance that produced it. There is no default and no fallback: a
 * missing or invalid quantity rejects the delivery rather than inventing one.
 */
export interface OrderQuantity {
  /** Volume in lots, from the AUTHORITATIVE Prompt-12 sizing result. */
  lots: number;
  /** Which sizing model was authoritative (1 = static contract table). */
  sizingModel: 1 | 2;
  /** Provenance of the authoritative model's specification. */
  specSource: "broker" | "static_v1";
  specAsOf: string | null;
}

/** Broker volume constraints a quantity must satisfy. Unknown fields are null. */
export interface VolumeLimits {
  minLot: number | null;
  maxLot: number | null;
  lotStep: number | null;
  /** Any additional broker volume ceiling reported by sizing. */
  volumeCap: number | null;
}

export type QuantityVerdict = { ok: true } | { ok: false; detail: string };

/**
 * Verifies a quantity is a real, tradable volume. Unknown broker limits are
 * simply not checked — they are never assumed to be satisfied by a default.
 */
export function validateQuantity(
  lots: number | null | undefined,
  limits: VolumeLimits,
): QuantityVerdict {
  if (typeof lots !== "number" || !Number.isFinite(lots) || lots <= 0) {
    return { ok: false, detail: "no finite positive position quantity was produced" };
  }
  if (limits.minLot !== null && lots < limits.minLot) {
    return { ok: false, detail: `${lots} is below the broker minimum volume ${limits.minLot}` };
  }
  if (limits.maxLot !== null && lots > limits.maxLot) {
    return { ok: false, detail: `${lots} exceeds the broker maximum volume ${limits.maxLot}` };
  }
  if (limits.volumeCap !== null && lots > limits.volumeCap) {
    return { ok: false, detail: `${lots} exceeds the broker volume ceiling ${limits.volumeCap}` };
  }
  const step = limits.lotStep;
  if (step !== null && step > 0) {
    const steps = lots / step;
    // Floating-point volumes must still land on a broker step boundary.
    if (Math.abs(steps - Math.round(steps)) > 1e-6) {
      return { ok: false, detail: `${lots} is not a multiple of the broker volume step ${step}` };
    }
  }
  return { ok: true };
}

/**
 * Bridge formats whose quantity/risk field we have VERIFIED against the
 * receiver contract. Anything absent here cannot be sent a live order with a
 * guessed volume syntax, so it stays dry-run-only for automatic execution.
 */
export const QUANTITY_VERIFIED_FORMATS = ["json"] as const;

export function bridgeSupportsVerifiedQuantity(format: string): boolean {
  return (QUANTITY_VERIFIED_FORMATS as readonly string[]).includes(format);
}

/**
 * How the order reaches the market.
 *
 * `pending_limit` is the default and the only mode the engine's own statistics
 * describe. `market` exists only for the owner-opted-in immediate-entry policy,
 * while price remains inside the published maximum acceptable entry.
 */
export type EntryMode = "pending_limit" | "market";

export interface BridgeOrder {
  signalId: string;
  instrument: string;
  /** A LIMIT unless the owner opted into immediate market entry; never a stop or stop-limit. */
  action: "buy_limit" | "sell_limit" | "buy" | "sell";
  /** Which of the two entry modes above this order uses. */
  entryMode: EntryMode;
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
  /** Authoritative position quantity. Part of the execution contract. */
  quantity: OrderQuantity;
}

export function buildBridgeOrder(
  signal: BridgeSignal,
  quantity: OrderQuantity,
  policy: ExecutionPolicy = DEFAULT_EXECUTION_POLICY,
  /** The owner's automatic-order window; the submitted order cannot outlive it. */
  expiresInMinutes: number = ORDER_TIF_MINUTES,
  entryMode: EntryMode = "pending_limit",
): BridgeOrder {
  if (policy !== "single_exit_first_target") {
    throw new Error(`unsupported execution policy: ${String(policy)}`);
  }
  const long = signal.direction === "long";
  return {
    signalId: signal.id,
    instrument: signal.instrument,
    action: entryMode === "market" ? (long ? "buy" : "sell") : long ? "buy_limit" : "sell_limit",
    entryMode,
    entry: signal.entryPrice,
    maxAcceptableEntry: signal.maxAcceptableEntry,
    stopLoss: signal.stopLoss,
    takeProfit: signal.tp1,
    expiresInMinutes,
    policy,
    grade: String(signal.grade),
    rr: signal.rrRatio,
    confidence: signal.confidence,
    quantity,
  };
}

/**
 * True when the live broker price is still on the tradable side of the slippage
 * ceiling. Beyond it the payoff the grade was based on no longer holds, so the
 * order is rejected rather than slipped in.
 *
 * This is the MARKET-ENTRY rule: it is what a trader entering at market must
 * respect, and it is what the feed and the alerts state. It is NOT the rule for
 * a pending limit order — see `pendingLimitSideValid`.
 */
export function withinMaxAcceptableEntry(
  order: Pick<BridgeOrder, "action" | "maxAcceptableEntry">,
  price: number,
): boolean {
  const long = order.action === "buy_limit" || order.action === "buy";
  return long ? price <= order.maxAcceptableEntry : price >= order.maxAcceptableEntry;
}

/**
 * True when a PENDING limit order can legitimately rest at its planned price.
 *
 * P-Trades submits pending limits, never market orders. A buy limit must sit
 * BELOW the current ask (and a sell limit above the current bid) by at least the
 * broker's minimum distance; the market having run away above a buy limit is
 * harmless — the order simply waits and can only ever fill at the planned price
 * or better. The dangerous case is the market already at or through the limit,
 * where the order would fill at an unplanned price or be refused outright.
 *
 * `minDistance` is the broker-reported minimum, or 0 when only the side is being
 * asserted. It is never guessed: a caller that requires the broker's distance and
 * cannot read it must refuse instead of passing a substitute.
 */
export function pendingLimitSideValid(
  order: Pick<BridgeOrder, "action" | "entry">,
  price: number,
  minDistance = 0,
): boolean {
  if (!(price > 0) || !(order.entry > 0)) return false;
  if (!Number.isFinite(minDistance) || minDistance < 0) return false;
  // The market must be strictly on the far side: sitting exactly ON the limit is
  // not a pending order that waits, it is one that fills at an unplanned moment
  // or is refused by the broker outright.
  const long = order.action === "buy_limit" || order.action === "buy";
  const gap = long ? price - order.entry : order.entry - price;
  return gap > 0 && gap >= minDistance;
}

export function spreadAcceptable(
  order: Pick<BridgeOrder, "entry" | "stopLoss">,
  bid: number,
  ask: number,
): boolean {
  const risk = Math.abs(order.entry - order.stopLoss);
  if (!(risk > 0) || !validQuoteGeometry(bid, ask)) return false;
  const spread = ask - bid;
  return spread <= risk * MAX_SPREAD_FRACTION_OF_RISK;
}
