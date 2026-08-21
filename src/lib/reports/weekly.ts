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
import {
  clusterBootstrapProportionDifference,
  type ProportionObservation,
} from "@/lib/stats/bootstrap";


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
  /** Mature (past the horizon) but still not resolved. Disclosed, never dropped. */
  pendingResolution: number;
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

/**
 * The PRIMARY dependence-aware comparison interval: a deterministic whole-UTC-day
 * cluster bootstrap of the difference in rates. `z`/`pValue` are secondary,
 * explicitly independence-assuming diagnostics and never drive a verdict.
 */
export interface DependenceAwareInterval {
  status: string;
  difference: number | null;
  ciLo: number | null;
  ciHi: number | null;
  ciLevel: number;
  excludesNull: boolean;
  clusterN: number;
  method: string;
  version: number;
  seed: number;
  runId: string;
  replicates: number;
  reason: string | null;
}

export interface Comparison {
  metric: "fill_rate" | "win_rate";
  label: string;
  highRate: number | null;
  lowRate: number | null;
  highN: number;
  lowN: number;
  difference: number | null;
  /** Independence-assuming diagnostic only. Never a verdict input. */
  z: number | null;
  pValue: number | null;
  verdict: Verdict;
  note: string;
  /** Independent UTC trading days behind each rate. */
  highClusters: number;
  lowClusters: number;
  /** Primary dependence-aware interval. Null when clusters are insufficient. */
  interval: DependenceAwareInterval;
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
    pendingResolution: mine.length - resolved.length,
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

/** Rows → bootstrap observations. Rows without a detection stamp cannot be
 *  clustered honestly and are excluded from the dependence-aware frame only. */
function toObservations(
  rows: ShadowRow[],
  group: "A" | "B",
  success: (r: ShadowRow) => boolean,
): ProportionObservation[] {
  return rows
    .filter((r) => typeof r.detected_at === "string" && r.detected_at)
    .map((r, i) => ({
      id: `${group}:${r.id ?? i}`,
      detectedAt: r.detected_at as string,
      group,
      success: success(r),
    }));
}

function buildComparison(
  metric: Comparison["metric"],
  label: string,
  highRows: ShadowRow[],
  lowRows: ShadowRow[],
  success: (r: ShadowRow) => boolean,
): Comparison {
  const highSuccesses = highRows.filter(success).length;
  const lowSuccesses = lowRows.filter(success).length;
  const highN = highRows.length;
  const lowN = lowRows.length;

  const highRate = highN ? highSuccesses / highN : null;
  const lowRate = lowN ? lowSuccesses / lowN : null;
  const difference = highRate !== null && lowRate !== null ? highRate - lowRate : null;

  // PRIMARY interval: whole-UTC-day cluster bootstrap of the rate difference.
  const boot = clusterBootstrapProportionDifference([
    ...toObservations(highRows, "A", success),
    ...toObservations(lowRows, "B", success),
  ]);
  const interval: DependenceAwareInterval = {
    status: boot.status,
    difference: boot.difference,
    ciLo: boot.ciLo,
    ciHi: boot.ciHi,
    ciLevel: boot.ciLevel,
    excludesNull: boot.excludesNull,
    clusterN: boot.clusterN,
    method: boot.method,
    version: boot.version,
    seed: boot.seed,
    runId: boot.runId,
    replicates: boot.replicates,
    reason: boot.reason,
  };

  // SECONDARY diagnostic only: assumes independence, which intraday setups
  // violate. It never enters the evidence decision.
  const { z, pValue } =
    highN > 0 && lowN > 0
      ? twoProportionZTest(highSuccesses, highN, lowSuccesses, lowN)
      : { z: null, pValue: null };

  const evidence = assessEvidence({
    nA: highN,
    nB: lowN,
    clustersA: boot.clustersA,
    clustersB: boot.clustersB,
    observedEffect: difference,
    // This weekly high-vs-low split is a standing descriptive readout, not a
    // predeclared, multiplicity-controlled hypothesis in the experiment ledger.
    predeclared: false,
    multiplicityControlled: false,
    // Derived from the dependence-aware bootstrap interval, never from a p-value.
    intervalExcludesNull: boot.status === "ok" && boot.excludesNull,
    holdoutConfirmed: holdoutConfirmed(),
  });

  const base = {
    metric,
    label,
    highRate,
    lowRate,
    highN,
    lowN,
    highClusters: boot.clustersA,
    lowClusters: boot.clustersB,
    difference,
    interval,
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
  const ciText =
    boot.status === "ok"
      ? `${(boot.ciLo! * 100).toFixed(1)} to ${(boot.ciHi! * 100).toFixed(1)} pts`
      : "no dependence-aware interval";
  // "significant" is never claimed on the strength of a p-value alone.
  const significant = evidence.level === "actionable" || evidence.level === "suggestive";
  return {
    ...base,
    z,
    pValue,
    verdict: significant ? "significant" : "not_significant",
    note: significant
      ? `A/A+ is ${direction} than B/C (day-cluster bootstrap 95% interval ${ciText}, ${boot.clustersA} vs ${boot.clustersB} independent days). ${evidence.note}`
      : `A/A+ is ${direction} than B/C (day-cluster bootstrap 95% interval ${ciText}), but this is descriptive only. ${evidence.blockers.join(" ")}`,
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
      buildComparison("fill_rate", "Fill rate (filled / resolved)", highRows, lowRows, (r) =>
        r.filled_at !== null,
      ),
      buildComparison(
        "win_rate",
        "Win rate (wins / filled)",
        highFilledRows,
        lowFilledRows,
        (r) => r.resolved_outcome === "win",
      ),
    ],

  };
}
