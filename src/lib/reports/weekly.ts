/**
 * Weekly shadow-report types and statistics. Pure maths, client-safe.
 *
 * ZERO-HALLUCINATION: every figure is computed from live shadow_executions
 * rows. Zero stays zero, and a comparison with too few samples returns an
 * explicit "insufficient" verdict rather than a fabricated number.
 */

/** Minimum resolved rows per tier before a comparison is worth reading. */
export const MIN_TIER_SAMPLES = 30;

export type TierKey = "high" | "low";

export interface TierStats {
  tier: TierKey;
  label: string;
  grades: string[];
  enrolled: number;
  resolved: number;
  filled: number;
  wins: number;
  losses: number;
  neverFilled: number;
  expired: number;
  fillRate: number | null;
  winRate: number | null;
  meanR: number | null;
  totalR: number;
  expectancyR: number | null;
  medianMissAtr: number | null;
}

export type Verdict = "significant" | "not_significant" | "insufficient";

export interface Comparison {
  metric: "fill_rate" | "win_rate";
  label: string;
  highRate: number | null;
  lowRate: number | null;
  highN: number;
  lowN: number;
  difference: number | null;
  z: number | null;
  pValue: number | null;
  verdict: Verdict;
  note: string;
}

export interface WeeklyReport {
  generatedAt: string;
  isoWeek: string;
  windowStart: string;
  windowEnd: string;
  totalResolved: number;
  high: TierStats;
  low: TierStats;
  comparisons: Comparison[];
}

export const HIGH_GRADES = ["A+", "A"];
export const LOW_GRADES = ["B", "C"];

/** Abramowitz & Stegun 7.1.26 error function — accurate to ~1e-7. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

export function normalTwoSidedP(z: number): number {
  return 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)));
}

export interface ZTestResult {
  z: number | null;
  pValue: number | null;
}

/** Pooled two-proportion z-test. Returns nulls when the pooled variance is degenerate. */
export function twoProportionZTest(
  successesA: number,
  nA: number,
  successesB: number,
  nB: number,
): ZTestResult {
  if (nA <= 0 || nB <= 0) return { z: null, pValue: null };
  const pA = successesA / nA;
  const pB = successesB / nB;
  const pooled = (successesA + successesB) / (nA + nB);
  const variance = pooled * (1 - pooled) * (1 / nA + 1 / nB);
  if (variance <= 0) return { z: null, pValue: null };
  const z = (pA - pB) / Math.sqrt(variance);
  return { z, pValue: normalTwoSidedP(z) };
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** ISO-8601 week key, e.g. "2026-W34". Used as the send latch and idempotency key. */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export interface ShadowRow {
  grade: string;
  status: string;
  resolved_outcome: string | null;
  realized_r: number | string | null;
  filled_at: string | null;
  miss_distance_atr: number | string | null;
}

const numOrNull = (v: number | string | null): number | null =>
  v === null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;

export function tierStats(rows: ShadowRow[], tier: TierKey): TierStats {
  const grades = tier === "high" ? HIGH_GRADES : LOW_GRADES;
  const mine = rows.filter((r) => grades.includes(r.grade));
  const resolved = mine.filter((r) => r.status === "resolved");
  const filled = resolved.filter((r) => r.filled_at !== null);
  const wins = resolved.filter((r) => r.resolved_outcome === "win");
  const losses = resolved.filter((r) => r.resolved_outcome === "loss");
  const neverFilled = resolved.filter((r) => r.resolved_outcome === "never_filled");
  const expired = resolved.filter((r) => r.resolved_outcome === "expired");

  const rValues = filled.map((r) => numOrNull(r.realized_r)).filter((v): v is number => v !== null);
  const totalR = rValues.reduce((a, b) => a + b, 0);
  const winR = rValues.filter((v) => v > 0);
  const lossR = rValues.filter((v) => v <= 0);

  let expectancyR: number | null = null;
  if (rValues.length > 0) {
    const winRateOfR = winR.length / rValues.length;
    const avgWin = winR.length ? winR.reduce((a, b) => a + b, 0) / winR.length : 0;
    const avgLoss = lossR.length ? Math.abs(lossR.reduce((a, b) => a + b, 0) / lossR.length) : 0;
    expectancyR = winRateOfR * avgWin - (1 - winRateOfR) * avgLoss;
  }

  const missValues = resolved
    .filter((r) => r.filled_at === null)
    .map((r) => numOrNull(r.miss_distance_atr))
    .filter((v): v is number => v !== null);

  return {
    tier,
    label: tier === "high" ? "A / A+" : "B / C",
    grades,
    enrolled: mine.length,
    resolved: resolved.length,
    filled: filled.length,
    wins: wins.length,
    losses: losses.length,
    neverFilled: neverFilled.length,
    expired: expired.length,
    fillRate: resolved.length ? filled.length / resolved.length : null,
    winRate: filled.length ? wins.length / filled.length : null,
    meanR: rValues.length ? totalR / rValues.length : null,
    totalR,
    expectancyR,
    medianMissAtr: median(missValues),
  };
}

function buildComparison(
  metric: Comparison["metric"],
  label: string,
  high: { successes: number; n: number },
  low: { successes: number; n: number },
  sufficient: boolean,
): Comparison {
  const highRate = high.n ? high.successes / high.n : null;
  const lowRate = low.n ? low.successes / low.n : null;

  if (!sufficient || high.n === 0 || low.n === 0) {
    return {
      metric,
      label,
      highRate,
      lowRate,
      highN: high.n,
      lowN: low.n,
      difference: highRate !== null && lowRate !== null ? highRate - lowRate : null,
      z: null,
      pValue: null,
      verdict: "insufficient",
      note: `Not enough data: ${high.n} vs ${low.n} samples (need ${MIN_TIER_SAMPLES} per tier). No conclusion drawn.`,
    };
  }

  const { z, pValue } = twoProportionZTest(high.successes, high.n, low.successes, low.n);
  const significant = pValue !== null && pValue < 0.05;
  const direction = (highRate ?? 0) >= (lowRate ?? 0) ? "higher" : "lower";
  return {
    metric,
    label,
    highRate,
    lowRate,
    highN: high.n,
    lowN: low.n,
    difference: highRate !== null && lowRate !== null ? highRate - lowRate : null,
    z,
    pValue,
    verdict: significant ? "significant" : "not_significant",
    note: significant
      ? `A/A+ is ${direction} than B/C and the difference is statistically significant (p = ${pValue!.toFixed(4)}).`
      : `A/A+ is ${direction} than B/C, but the difference is not statistically significant (p = ${pValue === null ? "n/a" : pValue.toFixed(4)}).`,
  };
}

export function buildReport(input: {
  rows: ShadowRow[];
  windowStart: string;
  windowEnd: string;
  generatedAt?: string;
}): WeeklyReport {
  const high = tierStats(input.rows, "high");
  const low = tierStats(input.rows, "low");
  const sufficientFill = high.resolved >= MIN_TIER_SAMPLES && low.resolved >= MIN_TIER_SAMPLES;
  const sufficientWin = high.filled >= MIN_TIER_SAMPLES && low.filled >= MIN_TIER_SAMPLES;

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    isoWeek: isoWeekKey(new Date(input.windowEnd)),
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    totalResolved: high.resolved + low.resolved,
    high,
    low,
    comparisons: [
      buildComparison(
        "fill_rate",
        "Fill rate (filled / resolved)",
        { successes: high.filled, n: high.resolved },
        { successes: low.filled, n: low.resolved },
        sufficientFill,
      ),
      buildComparison(
        "win_rate",
        "Win rate (wins / filled)",
        { successes: high.wins, n: high.filled },
        { successes: low.wins, n: low.filled },
        sufficientWin,
      ),
    ],
  };
}
