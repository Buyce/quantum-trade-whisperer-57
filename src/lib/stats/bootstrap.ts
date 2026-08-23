/**
 * Dependence-aware cluster bootstrap — the PRIMARY interval for every headline
 * figure in P-Trades.
 *
 * Resampling unit: the whole UTC `detected_at` day. When a day is drawn, every
 * observation in that day enters the replicate. Determinism is total:
 *  - rows are put into the stable total order (`detectedAt`, then `id`)
 *  - clusters are drawn from a seeded PRNG
 *  - accumulation order is fixed (cluster order, then within-cluster order)
 *  - method, version, seed and run id are returned for storage
 *
 * Two runs with the same input and seed are byte-identical.
 */
import { buildDayClusters, stableOrder, type ClusterableObservation } from "./clusters";

export const BOOTSTRAP_METHOD = "whole_utc_day_cluster_bootstrap";
export const BOOTSTRAP_VERSION = 1;
export const DEFAULT_REPLICATES = 2000;
export const DEFAULT_SEED = 20260821;

/** Minimum independent day clusters before an interval is reported at all. */
export const MIN_CLUSTERS = 10;

export interface RObservation extends ClusterableObservation {
  r: number;
}

export type BootstrapStatus = "ok" | "insufficient_clusters" | "empty";

export interface BootstrapResult {
  status: BootstrapStatus;
  n: number;
  clusterN: number;
  mean: number | null;
  ciLo: number | null;
  ciHi: number | null;
  ciLevel: number;
  method: string;
  version: number;
  seed: number;
  runId: string;
  replicates: number;
  reason: string | null;
}

/** mulberry32 — small, fast, fully specified, reproducible across runtimes. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fixed accumulation order; no parallel/partial summation. */
function meanInOrder(values: readonly number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export interface BootstrapOptions {
  level?: number;
  replicates?: number;
  seed?: number;
  runId?: string;
  minClusters?: number;
}

export function clusterBootstrapMeanR(
  rows: readonly RObservation[],
  options: BootstrapOptions = {},
): BootstrapResult {
  const level = options.level ?? 0.95;
  const replicates = options.replicates ?? DEFAULT_REPLICATES;
  const seed = options.seed ?? DEFAULT_SEED;
  const minClusters = options.minClusters ?? MIN_CLUSTERS;
  const runId =
    options.runId ?? `${BOOTSTRAP_METHOD}:v${BOOTSTRAP_VERSION}:seed${seed}:B${replicates}`;

  const ordered = stableOrder(rows);
  const clusters = buildDayClusters(ordered);

  const base: BootstrapResult = {
    status: "empty",
    n: ordered.length,
    clusterN: clusters.length,
    mean: null,
    ciLo: null,
    ciHi: null,
    ciLevel: level,
    method: BOOTSTRAP_METHOD,
    version: BOOTSTRAP_VERSION,
    seed,
    runId,
    replicates,
    reason: "No observations.",
  };

  if (ordered.length === 0) return base;

  const pointMean = meanInOrder(ordered.map((r) => r.r));

  if (clusters.length < minClusters) {
    return {
      ...base,
      status: "insufficient_clusters",
      mean: pointMean,
      reason: `Only ${clusters.length} independent trading day(s); ${minClusters} required before an interval is reported.`,
    };
  }

  const replicateMeans: number[] = [];
  const rng = createRng(seed);
  for (let b = 0; b < replicates; b++) {
    // Draw cluster indices first, then accumulate in draw order — fixed order.
    const values: number[] = [];
    for (let c = 0; c < clusters.length; c++) {
      const idx = Math.floor(rng() * clusters.length);
      const cluster = clusters[Math.min(idx, clusters.length - 1)]!;
      for (const row of cluster.rows) values.push(row.r);
    }
    replicateMeans.push(meanInOrder(values));
  }
  replicateMeans.sort((a, b) => a - b);
  const alpha = (1 - level) / 2;

  return {
    ...base,
    status: "ok",
    mean: pointMean,
    ciLo: percentile(replicateMeans, alpha),
    ciHi: percentile(replicateMeans, 1 - alpha),
    reason: null,
  };
}

/* ------------------------------------------- proportion-difference bootstrap */

/**
 * One observation in a two-group proportion comparison. The cluster (whole UTC
 * detected day) is shared across BOTH groups: when a day is drawn, every
 * observation from that day — group A and group B alike — enters the replicate
 * together. That is what makes the interval dependence-aware.
 */
export interface ProportionObservation extends ClusterableObservation {
  group: "A" | "B";
  success: boolean;
}

export type DifferenceStatus = "ok" | "insufficient_clusters" | "empty" | "degenerate";

export interface DifferenceResult {
  status: DifferenceStatus;
  /** Raw observations per group. */
  nA: number;
  nB: number;
  /** Independent UTC-day clusters per group. */
  clustersA: number;
  clustersB: number;
  /** Independent UTC-day clusters over the combined resampling frame. */
  clusterN: number;
  rateA: number | null;
  rateB: number | null;
  /** Point estimate rateA - rateB. */
  difference: number | null;
  ciLo: number | null;
  ciHi: number | null;
  ciLevel: number;
  /** True only when a real interval exists AND it lies wholly one side of 0. */
  excludesNull: boolean;
  method: string;
  version: number;
  seed: number;
  runId: string;
  replicates: number;
  /** Replicates discarded because a group was empty in the drawn days. */
  degenerateReplicates: number;
  reason: string | null;
}

/**
 * Deterministic whole-UTC-day cluster bootstrap of a difference in proportions.
 *
 * Determinism is total: stable total order, seeded mulberry32, fixed
 * accumulation order, and method/version/seed/run_id returned for storage.
 * Two runs on the same rows with the same seed are byte-identical regardless of
 * input row order.
 *
 * If either group has fewer than `minClusters` independent days, NO interval is
 * returned — the caller must treat that as insufficient evidence.
 */
export function clusterBootstrapProportionDifference(
  rows: readonly ProportionObservation[],
  options: BootstrapOptions = {},
): DifferenceResult {
  const level = options.level ?? 0.95;
  const replicates = options.replicates ?? DEFAULT_REPLICATES;
  const seed = options.seed ?? DEFAULT_SEED;
  const minClusters = options.minClusters ?? MIN_CLUSTERS;
  const runId =
    options.runId ?? `${BOOTSTRAP_METHOD}:diff:v${BOOTSTRAP_VERSION}:seed${seed}:B${replicates}`;

  const ordered = stableOrder(rows);
  const clusters = buildDayClusters(ordered);
  const groupA = ordered.filter((r) => r.group === "A");
  const groupB = ordered.filter((r) => r.group === "B");
  const clustersA = buildDayClusters(groupA).length;
  const clustersB = buildDayClusters(groupB).length;

  const rateA = groupA.length ? groupA.filter((r) => r.success).length / groupA.length : null;
  const rateB = groupB.length ? groupB.filter((r) => r.success).length / groupB.length : null;
  const difference = rateA !== null && rateB !== null ? rateA - rateB : null;

  const base: DifferenceResult = {
    status: "empty",
    nA: groupA.length,
    nB: groupB.length,
    clustersA,
    clustersB,
    clusterN: clusters.length,
    rateA,
    rateB,
    difference,
    ciLo: null,
    ciHi: null,
    ciLevel: level,
    excludesNull: false,
    method: BOOTSTRAP_METHOD,
    version: BOOTSTRAP_VERSION,
    seed,
    runId,
    replicates,
    degenerateReplicates: 0,
    reason: "No observations in one or both groups.",
  };

  if (groupA.length === 0 || groupB.length === 0) return base;

  if (clustersA < minClusters || clustersB < minClusters) {
    return {
      ...base,
      status: "insufficient_clusters",
      reason:
        `Only ${clustersA} vs ${clustersB} independent trading day(s); ` +
        `${minClusters} required per group before a dependence-aware interval is reported.`,
    };
  }

  const diffs: number[] = [];
  let degenerate = 0;
  const rng = createRng(seed);
  for (let b = 0; b < replicates; b++) {
    // Draw whole days; every observation of a drawn day enters the replicate.
    let aTotal = 0;
    let aWins = 0;
    let bTotal = 0;
    let bWins = 0;
    for (let c = 0; c < clusters.length; c++) {
      const idx = Math.floor(rng() * clusters.length);
      const cluster = clusters[Math.min(idx, clusters.length - 1)]!;
      for (const row of cluster.rows) {
        if (row.group === "A") {
          aTotal += 1;
          if (row.success) aWins += 1;
        } else {
          bTotal += 1;
          if (row.success) bWins += 1;
        }
      }
    }
    if (aTotal === 0 || bTotal === 0) {
      degenerate += 1;
      continue;
    }
    diffs.push(aWins / aTotal - bWins / bTotal);
  }

  if (diffs.length === 0) {
    return {
      ...base,
      status: "degenerate",
      degenerateReplicates: degenerate,
      reason: "Every bootstrap replicate left one group empty; no interval exists.",
    };
  }

  diffs.sort((a, b) => a - b);
  const alpha = (1 - level) / 2;
  const ciLo = percentile(diffs, alpha);
  const ciHi = percentile(diffs, 1 - alpha);

  return {
    ...base,
    status: "ok",
    ciLo,
    ciHi,
    excludesNull: (ciLo > 0 && ciHi > 0) || (ciLo < 0 && ciHi < 0),
    degenerateReplicates: degenerate,
    reason: null,
  };
}
