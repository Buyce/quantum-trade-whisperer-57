/**
 * Correlation groups (Wave 2).
 *
 * Gold and silver, WTI and Brent, and a US index are not independent bets. Summing
 * their risk as if they were understates portfolio exposure, so the advisory
 * exposure calculation treats a GROUP as one exposure rather than as N.
 *
 * These groupings are structural, not estimated: they are asserted because the
 * instruments share an underlying (crude oil), a metal complex, or the same equity
 * risk factor. No correlation coefficient is claimed — a number like "0.86" would
 * need a measurement this system has not made.
 */
export const CORRELATION_GROUPS: Record<string, string> = {
  XAUUSD: "metals_usd",
  XAGUSD: "metals_usd",
  USOIL: "energy",
  UKOIL: "energy",
  NAS100: "index_risk",
};

/** The group an instrument belongs to; its own symbol when it stands alone. */
export function correlationGroupOf(symbol: string): string {
  return CORRELATION_GROUPS[symbol] ?? symbol;
}

export interface GroupedExposure {
  groupKey: string;
  symbols: string[];
  /** Largest single-instrument risk in the group, in account currency. */
  worstCaseRisk: number;
  /** Naive sum, kept only so a diagnostic can show the difference. */
  naiveSum: number;
}

/**
 * Aggregate per-instrument risk into correlated groups.
 *
 * Within a group the exposure is taken as the SUM (positions in WTI and Brent can
 * lose together), which is the conservative reading; the naive sum is retained so
 * the Admin diagnostic can show what a per-instrument view would have claimed.
 */
export function groupExposure(
  risks: { instrument: string; risk: number }[],
): GroupedExposure[] {
  const byGroup = new Map<string, GroupedExposure>();
  for (const { instrument, risk } of risks) {
    const groupKey = correlationGroupOf(instrument);
    const entry = byGroup.get(groupKey) ?? {
      groupKey,
      symbols: [],
      worstCaseRisk: 0,
      naiveSum: 0,
    };
    entry.symbols.push(instrument);
    entry.worstCaseRisk += risk;
    entry.naiveSum += risk;
    byGroup.set(groupKey, entry);
  }
  return [...byGroup.values()];
}

/** Distinct correlated exposures, which is what an exposure limit should count. */
export function correlatedExposureCount(instruments: string[]): number {
  return new Set(instruments.map(correlationGroupOf)).size;
}
