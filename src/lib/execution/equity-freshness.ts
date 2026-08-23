/**
 * Prompt 14 Stage 5 (pre-flight 2) — broker equity freshness, as pure rules.
 *
 * A direct order's volume is derived from the DESTINATION broker's equity. That
 * number decays: a figure observed twenty minutes ago may no longer describe the
 * account the order is about to land in. Two separate rules therefore exist and
 * are kept apart deliberately:
 *
 *  1. `equityFresh` — is the observation recent enough to AUTHORIZE a quantity
 *     at all? Missing or unparseable observation time is never treated as fresh.
 *  2. `materialEquityChange` — did equity move enough between authorization and
 *     the final pre-submit refresh that the authorized quantity no longer
 *     reflects the account? If so the caller must re-derive or refuse; it must
 *     never submit the stale quantity.
 *
 * Pure: no clock of its own, no I/O.
 */

/**
 * Age at which broker-reported equity stops being usable for sizing an order.
 *
 * Fifteen minutes: long enough to survive one worker cycle and a slow broker,
 * short enough that an intraday balance change cannot silently mis-size a trade.
 */
export const BROKER_EQUITY_MAX_AGE_MS = 15 * 60_000;

/**
 * Relative equity movement that invalidates an already-authorized quantity.
 *
 * 0.5% of equity is well below one unit of risk for any sane risk percentage, so
 * anything at or above it can change the lot size the trader actually wanted.
 */
export const EQUITY_MATERIAL_CHANGE_FRACTION = 0.005;

export type FreshnessVerdict =
  | { fresh: true; ageMs: number }
  | { fresh: false; ageMs: number | null; detail: string };

/** Is this broker equity observation recent enough to size an order from? */
export function equityFresh(
  observedAt: string | null | undefined,
  now: number,
  maxAgeMs: number = BROKER_EQUITY_MAX_AGE_MS,
): FreshnessVerdict {
  if (!observedAt) {
    return {
      fresh: false,
      ageMs: null,
      detail: "your broker did not say when it observed this account's equity",
    };
  }
  const ms = Date.parse(observedAt);
  if (!Number.isFinite(ms)) {
    return {
      fresh: false,
      ageMs: null,
      detail: "the broker's equity observation time could not be read",
    };
  }
  const ageMs = now - ms;
  // A timestamp from the future is not fresh, it is unusable.
  if (ageMs < -60_000) {
    return { fresh: false, ageMs, detail: "the broker's equity observation time is in the future" };
  }
  if (ageMs > maxAgeMs) {
    return {
      fresh: false,
      ageMs,
      detail: `the broker's equity reading is ${Math.round(ageMs / 1000)}s old, older than the ${Math.round(maxAgeMs / 1000)}s bound for sizing an order`,
    };
  }
  return { fresh: true, ageMs: Math.max(ageMs, 0) };
}

export interface EquityChangeVerdict {
  material: boolean;
  fraction: number | null;
  detail: string | null;
}

/**
 * Did equity move materially between the figure a quantity was authorized from
 * and the figure the broker reports at submission time?
 *
 * An unreadable refreshed equity is MATERIAL by construction: we cannot prove
 * the authorized quantity still matches the account.
 */
export function materialEquityChange(
  authorizedEquity: number | null,
  refreshedEquity: number | null,
  fractionLimit: number = EQUITY_MATERIAL_CHANGE_FRACTION,
): EquityChangeVerdict {
  if (
    authorizedEquity === null ||
    !Number.isFinite(authorizedEquity) ||
    authorizedEquity <= 0
  ) {
    return {
      material: true,
      fraction: null,
      detail: "the equity this order's size was authorized from is not usable",
    };
  }
  if (refreshedEquity === null || !Number.isFinite(refreshedEquity) || refreshedEquity <= 0) {
    return {
      material: true,
      fraction: null,
      detail: "your broker did not report a usable equity at submission time",
    };
  }
  const fraction = Math.abs(refreshedEquity - authorizedEquity) / authorizedEquity;
  if (fraction >= fractionLimit) {
    return {
      material: true,
      fraction,
      detail: `account equity moved ${(fraction * 100).toFixed(2)}% between sizing and submission, so the authorized size no longer matches the account`,
    };
  }
  return { material: false, fraction, detail: null };
}
