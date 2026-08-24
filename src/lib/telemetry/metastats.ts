/**
 * Prompt 14 Stage 5 — normalising MetaStats answers, as pure rules.
 *
 * MetaStats has three genuinely different answers and P-Trades must render all
 * three differently:
 *
 *  - OK          → broker-derived numbers, with the instant they were observed;
 *  - PROCESSING  → the vendor answered 202 with a Retry-After hint. The account
 *                  history is still being crunched. This is NOT zero trades, and
 *                  it is NOT a losing account. It renders as "still calculating";
 *  - UNAVAILABLE → the vendor refused or could not be reached, with the reason.
 *
 * Collapsing `processing` into zeros is the single most misleading thing this
 * layer could do, so the type system does not allow a numeric metric to exist
 * without an `ok` status.
 *
 * Pure: no fetch, no clock beyond values passed in.
 */

export type TelemetryStatus = "ok" | "processing" | "unavailable";

export interface NormalisedMetrics {
  trades: number | null;
  wonTrades: number | null;
  lostTrades: number | null;
  winRatePercent: number | null;
  profit: number | null;
  balance: number | null;
  equity: number | null;
  /** Broker-reported maximum drawdown, as the vendor expresses it. */
  maxDrawdownPercent: number | null;
  expectancy: number | null;
  averageWin: number | null;
  averageLoss: number | null;
}

export interface TelemetrySnapshot {
  status: TelemetryStatus;
  reason: string | null;
  retryAfterSeconds: number | null;
  /** Present only when `status === "ok"`. */
  metrics: NormalisedMetrics | null;
  observedAt: string | null;
}

const EMPTY: NormalisedMetrics = {
  trades: null,
  wonTrades: null,
  lostTrades: null,
  winRatePercent: null,
  profit: null,
  balance: null,
  equity: null,
  maxDrawdownPercent: null,
  expectancy: null,
  averageWin: null,
  averageLoss: null,
};

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Map the vendor's metric object into our field names. Absent stays null. */
export function normaliseMetrics(
  raw: Record<string, unknown> | null | undefined,
): NormalisedMetrics {
  if (!raw || typeof raw !== "object") return { ...EMPTY };
  return {
    trades: num(raw["trades"]),
    wonTrades: num(raw["wonTrades"]),
    lostTrades: num(raw["lostTrades"]),
    winRatePercent: num(raw["wonTradesPercent"]),
    profit: num(raw["profit"]),
    balance: num(raw["balance"]),
    equity: num(raw["equity"]),
    maxDrawdownPercent: num(raw["maxDrawdown"]) ?? num(raw["maxDrawdownPercent"]),
    expectancy: num(raw["expectancy"]),
    averageWin: num(raw["averageWin"]),
    averageLoss: num(raw["averageLoss"]),
  };
}

export type VendorResult =
  | { status: "ok"; data: Record<string, unknown>; observedAt: string }
  | { status: "processing"; retryAfterSeconds: number | null }
  | { status: "unavailable"; reason: string };

/**
 * Turn one vendor answer into a snapshot that is safe to store and render.
 *
 * `processing` and `unavailable` carry NO metrics at all: there is nothing to
 * round down to zero, because there is nothing.
 */
export function toSnapshot(result: VendorResult): TelemetrySnapshot {
  if (result.status === "ok") {
    return {
      status: "ok",
      reason: null,
      retryAfterSeconds: null,
      metrics: normaliseMetrics(result.data),
      observedAt: result.observedAt,
    };
  }
  if (result.status === "processing") {
    return {
      status: "processing",
      reason:
        "Your broker's statistics service is still calculating this account's history. No figures are available yet.",
      retryAfterSeconds: result.retryAfterSeconds,
      metrics: null,
      observedAt: null,
    };
  }
  return {
    status: "unavailable",
    reason: result.reason,
    retryAfterSeconds: null,
    metrics: null,
    observedAt: null,
  };
}

/** Copy for a snapshot. Never states a trading outcome for a non-`ok` status. */
export function describeSnapshot(snapshot: TelemetrySnapshot): string {
  switch (snapshot.status) {
    case "ok":
      return "BROKER-DERIVED account statistics.";
    case "processing":
      return snapshot.retryAfterSeconds
        ? `Still calculating — your broker asked us to wait about ${snapshot.retryAfterSeconds}s.`
        : "Still calculating.";
    case "unavailable":
      return `Unavailable: ${snapshot.reason ?? "no reason was given"}.`;
  }
}

/**
 * MetaStats is OBSERVATION ONLY.
 *
 * Nothing derived from it may change a grade, a confidence score, an eligibility
 * decision, a research population or a published statistic. This constant exists
 * so the rule is greppable and testable rather than merely intended.
 */
export const METASTATS_INFLUENCES = Object.freeze({
  grade: false,
  confidence: false,
  eligibility: false,
  research: false,
  publishedStatistics: false,
  /** It MAY be shown, and it MAY inform an execution refusal. Nothing else. */
  display: true,
  executionRefusal: true,
});

/** Minimum interval between paid MetaStats reads for one account. */
export const TELEMETRY_MIN_INTERVAL_SECONDS = 3600;

/** Hard cap on accounts touched in one worker pass, so cost stays bounded. */
export const TELEMETRY_ITEMS_PER_RUN = 10;

/** A stored snapshot older than this is labelled stale rather than current. */
export const TELEMETRY_STALE_AFTER_MS = 6 * 3_600_000;

export function snapshotStale(observedAt: string | null, now: number): boolean {
  if (!observedAt) return true;
  const ms = Date.parse(observedAt);
  if (!Number.isFinite(ms)) return true;
  return now - ms > TELEMETRY_STALE_AFTER_MS;
}

/**
 * Should an `unavailable` reason park the account instead of being retried on the
 * ordinary interval?
 *
 * An `unavailable` snapshot only carries a sentence, so the decision is made on
 * that sentence. Billing, subscription and feature refusals will not clear on
 * their own: retrying hourly keeps failing and, in the billing case, keeps
 * costing. A transient network or server problem is NOT parked.
 */
const PARK_PATTERNS = [
  /billing/i,
  /subscription/i,
  /payment/i,
  /not enabled/i,
  /not authori[sz]ed/i,
  /forbidden/i,
  /unauthori[sz]ed/i,
  /not found/i,
];

export function reasonShouldPark(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return PARK_PATTERNS.some((pattern) => pattern.test(reason));
}
