/**
 * Like-for-like grade comparison from broker-verified R outcomes.
 *
 * Why this exists: a blended "mean R per grade" row is not a grade comparison
 * when the grades did not trade the same things. In the live demo ledger the B
 * cohort is short-heavy (Gold short, GBP/AUD short) while the C cohort is
 * long-heavy (EUR/USD long, Gold long), so a blended table mostly measures
 * direction and instrument mix over a three-week window — not grade quality.
 *
 * Rules, in full, and deliberately conservative:
 * - Comparison is stratified: grades are only ever compared inside the same
 *   stratum (instrument x direction). Strata where one of the two grades is
 *   absent or below the cluster floor are excluded and reported as excluded.
 * - Repeated trades from one setup are collapsed to one cluster mean first, so a
 *   setup that filled four times counts once, not four times.
 * - The stratum weight is the harmonic weight (nHigher*nLower)/(nHigher+nLower),
 *   which is the standard precision weight for a difference of two means.
 * - The standard error is built from cluster-level variance inside each stratum.
 *   A stratum with fewer than two clusters on either side contributes no variance
 *   and is therefore excluded entirely rather than treated as certain.
 * - Below the evidence floor the verdict is `insufficient_evidence`. There is no
 *   ranking output in that case: an unresolved comparison is reported as
 *   unresolved, never rounded into a claim.
 *
 * Pure and total: no clock, no database, no I/O.
 */

/** Highest to lowest. Grades outside this ladder are not compared. */
export const GRADE_LADDER = ["A+", "A", "B", "C"] as const;
export type LadderGrade = (typeof GRADE_LADDER)[number];

/** Minimum distinct setups per grade inside one stratum for it to be usable. */
export const MIN_CLUSTERS_PER_STRATUM = 5;
/** Minimum usable setups per grade across all strata for any verdict at all. */
export const MIN_CLUSTERS_TOTAL = 20;

export interface GradeObservation {
  grade: string;
  /** Comparison stratum, e.g. `EURUSD long`. */
  stratum: string;
  /** Setup identity. Trades sharing a cluster are averaged before comparison. */
  cluster: string;
  /** Risk-normalised outcome (R vs plan). */
  r: number;
}

export interface StratumDetail {
  stratum: string;
  higherClusters: number;
  lowerClusters: number;
  higherMeanR: number;
  lowerMeanR: number;
}

export type GradeVerdict =
  "insufficient_evidence" | "no_separation" | "higher_grade_better" | "lower_grade_better";

export interface GradePairComparison {
  higherGrade: string;
  lowerGrade: string;
  /** Strata that met the cluster floor on both sides. */
  strata: StratumDetail[];
  /** Strata dropped for having too few setups on one side, with the reason. */
  excludedStrata: { stratum: string; higherClusters: number; lowerClusters: number }[];
  clustersHigher: number;
  clustersLower: number;
  /** Stratum-weighted mean R of the higher grade minus the lower grade. */
  diffR: number | null;
  se: number | null;
  ci95: [number, number] | null;
  verdict: GradeVerdict;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample variance of the mean, i.e. s^2 / n. Null below two observations. */
function varianceOfMean(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values);
  const s2 = values.reduce((acc, v) => acc + (v - m) * (v - m), 0) / (values.length - 1);
  return s2 / values.length;
}

/** Cluster means for one grade inside one stratum. */
function clusterMeans(rows: GradeObservation[]): number[] {
  const byCluster = new Map<string, number[]>();
  for (const row of rows) {
    const list = byCluster.get(row.cluster);
    if (list) list.push(row.r);
    else byCluster.set(row.cluster, [row.r]);
  }
  return [...byCluster.values()].map(mean);
}

/**
 * Compare two grades on like-for-like strata only.
 *
 * `observations` may contain any grades; anything outside the requested pair is
 * ignored. Non-finite R values must already be filtered out by the caller.
 */
export function compareGradePair(
  observations: GradeObservation[],
  higherGrade: string,
  lowerGrade: string,
): GradePairComparison {
  const strataKeys = [...new Set(observations.map((o) => o.stratum))].sort();
  const strata: StratumDetail[] = [];
  const excludedStrata: GradePairComparison["excludedStrata"] = [];

  let weightSum = 0;
  let weightedDiff = 0;
  let varAccumulator = 0;
  let clustersHigher = 0;
  let clustersLower = 0;

  for (const key of strataKeys) {
    const rows = observations.filter((o) => o.stratum === key);
    const higher = clusterMeans(rows.filter((o) => o.grade === higherGrade));
    const lower = clusterMeans(rows.filter((o) => o.grade === lowerGrade));

    if (
      higher.length < MIN_CLUSTERS_PER_STRATUM ||
      lower.length < MIN_CLUSTERS_PER_STRATUM ||
      higher.length < 2 ||
      lower.length < 2
    ) {
      if (higher.length > 0 || lower.length > 0) {
        excludedStrata.push({
          stratum: key,
          higherClusters: higher.length,
          lowerClusters: lower.length,
        });
      }
      continue;
    }

    const vHigher = varianceOfMean(higher);
    const vLower = varianceOfMean(lower);
    if (vHigher === null || vLower === null) {
      excludedStrata.push({
        stratum: key,
        higherClusters: higher.length,
        lowerClusters: lower.length,
      });
      continue;
    }

    const mHigher = mean(higher);
    const mLower = mean(lower);
    const weight = (higher.length * lower.length) / (higher.length + lower.length);

    strata.push({
      stratum: key,
      higherClusters: higher.length,
      lowerClusters: lower.length,
      higherMeanR: mHigher,
      lowerMeanR: mLower,
    });
    clustersHigher += higher.length;
    clustersLower += lower.length;
    weightSum += weight;
    weightedDiff += weight * (mHigher - mLower);
    varAccumulator += weight * weight * (vHigher + vLower);
  }

  const enoughEvidence =
    weightSum > 0 && clustersHigher >= MIN_CLUSTERS_TOTAL && clustersLower >= MIN_CLUSTERS_TOTAL;

  if (!enoughEvidence) {
    return {
      higherGrade,
      lowerGrade,
      strata,
      excludedStrata,
      clustersHigher,
      clustersLower,
      diffR: null,
      se: null,
      ci95: null,
      verdict: "insufficient_evidence",
    };
  }

  const diffR = weightedDiff / weightSum;
  const se = Math.sqrt(varAccumulator) / weightSum;
  const ci95: [number, number] = [diffR - 1.96 * se, diffR + 1.96 * se];
  const verdict: GradeVerdict =
    ci95[0] > 0 ? "higher_grade_better" : ci95[1] < 0 ? "lower_grade_better" : "no_separation";

  return {
    higherGrade,
    lowerGrade,
    strata,
    excludedStrata,
    clustersHigher,
    clustersLower,
    diffR,
    se,
    ci95,
    verdict,
  };
}

/**
 * Every adjacent pair on the grade ladder that has observations on both sides.
 *
 * Adjacent only: a ladder is a claim about ordering between neighbours, and
 * comparing A+ directly with C hides which step, if any, actually separates.
 */
export function compareGradeLadder(observations: GradeObservation[]): GradePairComparison[] {
  const present = GRADE_LADDER.filter((g) => observations.some((o) => o.grade === g));
  const out: GradePairComparison[] = [];
  for (let i = 0; i + 1 < present.length; i += 1) {
    out.push(compareGradePair(observations, present[i]!, present[i + 1]!));
  }
  return out;
}
