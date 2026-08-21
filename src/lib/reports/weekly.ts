/**
 * Weekly shadow-report types and statistics. Pure maths, client-safe.
 *
 * ZERO-HALLUCINATION: every figure is computed from live shadow_executions
 * rows. Zero stays zero, and a comparison with too few samples returns an
 * explicit "insufficient" verdict rather than a fabricated number.
 *
 * SUFFICIENCY: this module does NOT define "enough data". Every verdict is
 * delegated to src/lib/stats/evidence.ts, the single gate shared with the admin
 * panels and the MCP tools, and every group is measured in independent UTC-day
 * clusters as well as raw rows.
 */
import { assessEvidence, holdoutConfirmed, MIN_GROUP_SAMPLES, type EvidenceVerdict } from "@/lib/stats/evidence";
import { countClusters } from "@/lib/stats/clusters";

/** Minimum resolved rows per tier before a comparison is worth reading. */
export const MIN_TIER_SAMPLES = MIN_GROUP_SAMPLES;

/**
 * Right-censoring guard. A plan detected less than this many hours before the
 * window edge has not had time to resolve, so counting it would bias the week's
 * fill and win rates. Such rows are excluded and reported as `immature`.
 */
export const MATURITY_HOURS = 24;

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
  /** Independent UTC trading days behind each rate. */
  highClusters: number;
  lowClusters: number;
  /** The shared sufficiency verdict. Authoritative over `verdict`. */
  evidence: EvidenceVerdict;
}

export interface WeeklyReport {
  generatedAt: string;
  isoWeek: string;
  windowStart: string;
  windowEnd: string;
  totalResolved: number;
  /** Rows dropped at the window edge for not having had time to resolve. */
  immature: number;
  maturityHours: number;
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
  id?: string;
  detected_at?: string | null;
  grade: string;
  status: string;
  resolved_outcome: string | null;
  realized_r: number | string | null;
  filled_at: string | null;
  miss_distance_atr: number | string | null;
}

const numOrNull = (v: number | string | null): number | null =>
  v === null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;

/** Independent UTC-day clusters behind a set of rows. */
function clustersOf(rows: ShadowRow[]): number {
  const usable = rows.filter((r) => typeof r.detected_at === "string" && r.detected_at);
  if (usable.length === 0) return 0;
  return countClusters(
    usable.map((r, i) => ({ id: r.id ?? String(i), detectedAt: r.detected_at as string })),
  );
}

/**
 * Splits rows at the maturity horizon. Plans detected too close to the window
 * edge are censored, not counted as unresolved.
 */
export function partitionByMaturity(
  rows: ShadowRow[],
  windowEnd: string,
  maturityHours: number = MATURITY_HOURS,
): { mature: ShadowRow[]; immature: ShadowRow[] } {
  const cutoff = new Date(windowEnd).getTime() - maturityHours * 3_600_000;
  const mature: ShadowRow[] = [];
  const immature: ShadowRow[] = [];
  for (const row of rows) {
    const detected = row.detected_at ? new Date(row.detected_at).getTime() : NaN;
    // Rows with no detection stamp cannot be censored honestly, so they are kept
    // and remain visible in the resolved/unresolved split.
    if (Number.isFinite(detected) && detected > cutoff) immature.push(row);
    else mature.push(row);
  }
  return { mature, immature };
}

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
  high: { successes: number; n: number; clusters: number },
  low: { successes: number; n: number; clusters: number },
): Comparison {
  const highRate = high.n ? high.successes / high.n : null;
  const lowRate = low.n ? low.successes / low.n : null;
  const difference = highRate !== null && lowRate !== null ? highRate - lowRate : null;

  const { z, pValue } =
    high.n > 0 && low.n > 0
      ? twoProportionZTest(high.successes, high.n, low.successes, low.n)
      : { z: null, pValue: null };

  // The z-test ignores within-day dependence, so it can only ever *lower* the
  // verdict here: the shared evidence gate decides what may be claimed.
  const evidence = assessEvidence({
    nA: high.n,
    nB: low.n,
    clustersA: high.clusters,
    clustersB: low.clusters,
    observedEffect: difference,
    // This weekly high-vs-low split is a standing descriptive readout, not a
    // predeclared, multiplicity-controlled hypothesis in the experiment ledger.
    predeclared: false,
    multiplicityControlled: false,
    intervalExcludesNull: pValue !== null && pValue < 0.05,
    holdoutConfirmed: holdoutConfirmed(),
  });

  const base = {
    metric,
    label,
    highRate,
    lowRate,
    highN: high.n,
    lowN: low.n,
    highClusters: high.clusters,
    lowClusters: low.clusters,
    difference,
    evidence,
  };

  if (evidence.level === "insufficient") {
    return {
      ...base,
      z: null,
      pValue: null,
      verdict: "insufficient",
      note: `${evidence.note} ${evidence.blockers.join(" ")}`.trim(),
    };
  }

  const direction = (highRate ?? 0) >= (lowRate ?? 0) ? "higher" : "lower";
  const pText = pValue === null ? "n/a" : pValue.toFixed(4);
  // "significant" is never claimed on the strength of a p-value alone.
  const significant = evidence.level === "actionable" || evidence.level === "suggestive";
  return {
    ...base,
    z,
    pValue,
    verdict: significant ? "significant" : "not_significant",
    note: significant
      ? `A/A+ is ${direction} than B/C (p = ${pText}, ${high.clusters} vs ${low.clusters} independent days). ${evidence.note}`
      : `A/A+ is ${direction} than B/C (p = ${pText}), but this is descriptive only. ${evidence.blockers.join(" ")}`,
  };
}

export function buildReport(input: {
  rows: ShadowRow[];
  windowStart: string;
  windowEnd: string;
  generatedAt?: string;
  maturityHours?: number;
}): WeeklyReport {
  const maturityHours = input.maturityHours ?? MATURITY_HOURS;
  const { mature, immature } = partitionByMaturity(input.rows, input.windowEnd, maturityHours);

  const high = tierStats(mature, "high");
  const low = tierStats(mature, "low");

  const highRows = mature.filter((r) => HIGH_GRADES.includes(r.grade) && r.status === "resolved");
  const lowRows = mature.filter((r) => LOW_GRADES.includes(r.grade) && r.status === "resolved");
  const highFilledRows = highRows.filter((r) => r.filled_at !== null);
  const lowFilledRows = lowRows.filter((r) => r.filled_at !== null);

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    isoWeek: isoWeekKey(new Date(input.windowEnd)),
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    totalResolved: high.resolved + low.resolved,
    immature: immature.length,
    maturityHours,
    high,
    low,
    comparisons: [
      buildComparison(
        "fill_rate",
        "Fill rate (filled / resolved)",
        { successes: high.filled, n: high.resolved, clusters: clustersOf(highRows) },
        { successes: low.filled, n: low.resolved, clusters: clustersOf(lowRows) },
      ),
      buildComparison(
        "win_rate",
        "Win rate (wins / filled)",
        { successes: high.wins, n: high.filled, clusters: clustersOf(highFilledRows) },
        { successes: low.wins, n: low.filled, clusters: clustersOf(lowFilledRows) },
      ),
    ],
  };
}
