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
