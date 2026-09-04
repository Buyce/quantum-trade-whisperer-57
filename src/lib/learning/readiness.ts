/**
 * Model-readiness surface (pure module — no I/O).
 *
 * Shapes and summarizers for `gate_readiness()`: per-gate matured sample
 * counts, cluster counts, the verdict the evidence reads, and whether the
 * dataset clears the *training* bar (enough to build a model on, not merely
 * enough to describe).
 *
 * Zero-hallucination rules enforced here:
 *  - Every number originates in `filter_lift_stats`, which is computed from
 *    replay-derived research outcomes on real candles. Nothing is invented,
 *    interpolated, or defaulted to a plausible-looking value.
 *  - A gate that has not cleared a floor is reported as not ready with the
 *    missing floor named; it is never rounded up into readiness.
 *  - "training_ready" is decided by the database, not re-derived here. This
 *    module only formats and explains it.
 */

export const READINESS_MIN_SAMPLES_PER_ARM = 200;
export const READINESS_MIN_CLUSTERS_PER_ARM = 10;
export const READINESS_MIN_TRADING_DAYS = 20;
/** Descriptive floor — enough to read a verdict, not enough to train on. */
export const DECIDABLE_MIN_SAMPLES_PER_ARM = 30;

export type TunableGate = "risk_ceiling" | "headroom" | "reachable_r";

export interface GateReadinessRow {
  gate: string;
  manifest_hash: string | null;
  current_value: number;
  override_active: boolean;
  pass_n_used: number | null;
  fail_n_used: number | null;
  pass_cluster_n: number | null;
  fail_cluster_n: number | null;
  pass_mean_r: number | null;
  fail_mean_r: number | null;
  pass_status: string | null;
  fail_status: string | null;
  decidable: boolean;
  verdict: "loosening_supported" | "gate_supported" | null;
  training_ready: boolean;
}

export interface GateReadiness {
  as_of: string;
  trading_days: number;
  min_trading_days: number;
  min_samples_per_arm: number;
  min_clusters_per_arm: number;
  auto_apply_enabled: boolean;
  gates: GateReadinessRow[];
  ready: boolean | null;
}

export const EMPTY_GATE_READINESS: GateReadiness = {
  as_of: "",
  trading_days: 0,
  min_trading_days: READINESS_MIN_TRADING_DAYS,
  min_samples_per_arm: READINESS_MIN_SAMPLES_PER_ARM,
  min_clusters_per_arm: READINESS_MIN_CLUSTERS_PER_ARM,
  auto_apply_enabled: false,
  gates: [],
  ready: false,
};

/**
 * Which floors a gate still misses, in plain language. An empty list means
 * every floor is cleared — it never means "unknown".
 */
export function missingFloors(row: GateReadinessRow, readiness: GateReadiness): string[] {
  const missing: string[] = [];
  const minN = readiness.min_samples_per_arm;
  const minC = readiness.min_clusters_per_arm;

  if ((row.pass_n_used ?? 0) < minN) {
    missing.push(`published arm needs ${minN} matured samples (has ${row.pass_n_used ?? 0})`);
  }
  if ((row.fail_n_used ?? 0) < minN) {
    missing.push(`rejected arm needs ${minN} matured samples (has ${row.fail_n_used ?? 0})`);
  }
  if ((row.pass_cluster_n ?? 0) < minC) {
    missing.push(`published arm needs ${minC} independent clusters (has ${row.pass_cluster_n ?? 0})`);
  }
  if ((row.fail_cluster_n ?? 0) < minC) {
    missing.push(`rejected arm needs ${minC} independent clusters (has ${row.fail_cluster_n ?? 0})`);
  }
  if (readiness.trading_days < readiness.min_trading_days) {
    missing.push(
      `needs ${readiness.min_trading_days} trading days of research outcomes (has ${readiness.trading_days})`,
    );
  }
  if (!row.decidable) {
    missing.push(
      `both arms must clear the ${DECIDABLE_MIN_SAMPLES_PER_ARM}-sample descriptive floor with a cluster-robust interval`,
    );
  } else if (row.verdict === null) {
    missing.push("the two 95% intervals still overlap, so no direction is supported");
  }
  return missing;
}

/** Gates whose evidence clears the training bar. */
export function readyGates(readiness: GateReadiness): GateReadinessRow[] {
  return readiness.gates.filter((g) => g.training_ready);
}

/** True when at least one gate is trainable. Mirrors the database's `ready`. */
export function isTrainingReady(readiness: GateReadiness): boolean {
  return readyGates(readiness).length > 0;
}

export const VERDICT_LABELS: Record<"loosening_supported" | "gate_supported", string> = {
  loosening_supported: "loosening supported",
  gate_supported: "gate supported",
};
