/** Maximum broker/server clock lead tolerated before a quote is untrustworthy. */
export const QUOTE_FUTURE_SKEW_MS = 30_000;

/** A tradable quote must be finite, positive and not crossed. */
export function validQuoteGeometry(bid: number, ask: number): boolean {
  return Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0 && ask >= bid;
}

/** Signed source age, or null when the broker timestamp is absent/malformed. */
export function quoteSourceAgeMs(
  sourceTime: string | null | undefined,
  now = Date.now(),
): number | null {
  const parsed = sourceTime ? Date.parse(sourceTime) : Number.NaN;
  return Number.isFinite(parsed) ? now - parsed : null;
}

/** Fresh means neither too old nor implausibly ahead of the server clock. */
export function quoteSourceFresh(
  sourceTime: string | null | undefined,
  maxAgeMs: number,
  now = Date.now(),
): boolean {
  const age = quoteSourceAgeMs(sourceTime, now);
  return age !== null && age <= maxAgeMs && age >= -QUOTE_FUTURE_SKEW_MS;
}

const HOUR_MS = 3_600_000;
/** Broker servers mislabelling their timezone/DST are off by whole hours. */
export const MAX_BROKER_CLOCK_OFFSET_HOURS = 3;
/** How close to a whole hour the gap must be to count as a clock mislabel. */
export const BROKER_CLOCK_OFFSET_TOLERANCE_MS = 60_000;

/**
 * Some brokers stamp prices with a clock that is a whole number of hours off
 * (wrong DST/timezone), so a live price looks exactly 1h old. Correct only
 * that case: the gap must be within ±60s of a whole hour, at most ±3h. A truly
 * frozen price drifts out of that window within a minute and stays stale.
 */
export function correctBrokerClockOffset(
  sourceTime: string | null,
  receivedAtMs: number,
): { sourceTime: string | null; offsetHours: number } {
  const parsed = sourceTime ? Date.parse(sourceTime) : Number.NaN;
  if (!Number.isFinite(parsed)) return { sourceTime, offsetHours: 0 };
  const gap = receivedAtMs - parsed;
  const hours = Math.round(gap / HOUR_MS);
  if (
    hours === 0 ||
    Math.abs(hours) > MAX_BROKER_CLOCK_OFFSET_HOURS ||
    Math.abs(gap - hours * HOUR_MS) > BROKER_CLOCK_OFFSET_TOLERANCE_MS
  ) {
    return { sourceTime, offsetHours: 0 };
  }
  return { sourceTime: new Date(parsed + hours * HOUR_MS).toISOString(), offsetHours: hours };
}
