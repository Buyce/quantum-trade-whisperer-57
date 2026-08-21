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
  const runId = options.runId ?? `${BOOTSTRAP_METHOD}:v${BOOTSTRAP_VERSION}:seed${seed}:B${replicates}`;

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
