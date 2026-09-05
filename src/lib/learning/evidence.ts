/**
 * Learning evidence surface (pure module — no I/O).
 *
 * Shapes and summarizers for the owner-only `get_admin_learning_evidence()`
 * payload: global filter-lift rows, per-slice rows (instrument / direction /
 * session), the gate-change proposal ledger, active threshold overrides, and
 * post-change verification cohorts.
 *
 * Zero-hallucination rules enforced here:
 *  - A slice thinner than the floors is rendered as its own "not yet
 *    decidable" state, never folded into the global number.
 *  - An interval exists only when the database computed a cluster-robust
 *    `se_r`; nothing is derived client-side from raw means.
 *  - Replay-derived research numbers are labelled as such by the caller; this
 *    module never converts them into money or broker outcomes.
 */
import { EVIDENCE_TIERS } from "@/lib/stats/evidence";


export interface LearningStatRow {
  manifest_hash: string;
  gate: string;
  arm: "pass" | "fail";
  slice_dim: "global" | "instrument" | "direction" | "session";
  slice_key: string;
  n_candidates: number;
  n_mature: number;
  n_used: number;
  cluster_n: number | null;
  replay_coverage: number | null;
  mean_r: number | null;
  se_r: number | null;
  stat_status: string;
  reason: string | null;
  computed_as_of: string;
}

export interface GateChangeProposal {
  id: string;
  gate: string;
  current_value: number | null;
  proposed_value: number;
  verdict: "loosening_supported" | "gate_supported";
  status: "proposed" | "approved" | "rejected" | "reverted";
  proposed_by: string;
  decided_by: string | null;
  decision_reason: string | null;
  decided_at: string | null;
  applied_at: string | null;
  reverted_at: string | null;
  created_at: string;
  /** Who opened it: the owner, or the hourly automation. */
  origin?: "operator" | "system";
  /** True when the automation both opened and applied it without a human. */
  auto_applied?: boolean;
  stats_snapshot: {
    as_of: string;
    manifest_hash: string;
    pass: ArmSnapshot;
    fail: ArmSnapshot;
  };
}

export interface ArmSnapshot {
  mean_r: number | null;
  se_r: number | null;
  n_used: number | null;
  cluster_n: number | null;
}

export interface GateOverride {
  gate: string;
  value: number;
  set_by: string;
  reason: string;
  proposal_id: string | null;
  updated_at: string;
}

export interface PostChangeCohort {
  proposal_id: string;
  gate: string;
  applied_at: string;
  arms: { arm: "pass" | "fail"; n_used: number; mean_r: number | null; cluster_n: number }[];
}

export interface LearningEvidence {
  generated_at: string;
  rows: LearningStatRow[];
  proposals: GateChangeProposal[];
  overrides: GateOverride[];
  post_change: PostChangeCohort[];
}

export const EMPTY_LEARNING_EVIDENCE: LearningEvidence = {
  generated_at: "",
  rows: [],
  proposals: [],
  overrides: [],
  post_change: [],
};

/**
 * 95% interval from the cluster-robust standard error the database computed over
 * whole-UTC-day clusters; null when unavailable. Nothing is derived from a raw
 * mean, and no interval is offered for a row without a recorded cluster count.
 */
export function ci95(
  row: Pick<LearningStatRow, "mean_r" | "se_r"> & { cluster_n?: number | null },
): [number, number] | null {
  if (row.mean_r === null || row.se_r === null) return null;
  if (!Number.isFinite(row.mean_r) || !Number.isFinite(row.se_r)) return null;
  if (row.cluster_n !== undefined && (row.cluster_n ?? 0) < EVIDENCE_TIERS.descriptive.minClusters) {
    return null;
  }
  return [row.mean_r - 1.96 * row.se_r, row.mean_r + 1.96 * row.se_r];
}


/** True when two intervals cannot be separated at the 95% level. */
export function intervalsOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

/** Global rows only — slice rows must never be mixed into the global read. */
export function globalRows(rows: LearningStatRow[]): LearningStatRow[] {
  return rows.filter((r) => r.slice_dim === "global");
}

export type SliceDim = Exclude<LearningStatRow["slice_dim"], "global">;

/** Slice rows grouped by dimension, ordered for display. */
export function slicesByDim(rows: LearningStatRow[]): Record<SliceDim, LearningStatRow[]> {
  const out: Record<SliceDim, LearningStatRow[]> = { instrument: [], direction: [], session: [] };
  for (const r of rows) {
    if (r.slice_dim === "global") continue;
    out[r.slice_dim].push(r);
  }
  for (const dim of Object.keys(out) as SliceDim[]) {
    out[dim].sort((a, b) =>
      a.gate === b.gate
        ? a.slice_key === b.slice_key
          ? a.arm.localeCompare(b.arm)
          : a.slice_key.localeCompare(b.slice_key)
        : a.gate.localeCompare(b.gate),
    );
  }
  return out;
}

/** One decidable slice must clear every floor on both arms. */
export function sliceDecidable(pass: LearningStatRow | undefined, fail: LearningStatRow | undefined): boolean {
  if (!pass || !fail) return false;
  if (pass.stat_status !== "descriptive" || fail.stat_status !== "descriptive") return false;
  const tier = EVIDENCE_TIERS.descriptive;
  if (pass.n_used < tier.minSamples || fail.n_used < tier.minSamples) return false;
  if ((pass.cluster_n ?? 0) < tier.minClusters || (fail.cluster_n ?? 0) < tier.minClusters) {
    return false;
  }
  return ci95(pass) !== null && ci95(fail) !== null;
}


export const PROPOSAL_STATUS_LABELS: Record<GateChangeProposal["status"], string> = {
  proposed: "Awaiting decision",
  approved: "Approved — override active",
  rejected: "Rejected",
  reverted: "Reverted to previous value",
};

export const TUNABLE_GATE_LABELS: Record<string, string> = {
  risk_ceiling: "Risk ceiling (max risk in ATR)",
  headroom: "Headroom (min space to H4 structure, ATR)",
  reachable_r: "Reachable R (min reward-to-risk)",
};
