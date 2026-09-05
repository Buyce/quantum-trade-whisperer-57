/**
 * Walk-forward confirmation pass (read + record).
 *
 * Reads the SAME research population filter lift reads — research-candidate
 * cohort, Replay V1, the approved execution policy, the common research ladder —
 * and re-measures each gate's pass/fail difference on a chronological split:
 * earlier days train, later days are held out.
 *
 * The result is written to `walk_forward_confirmations`, which the gate-change
 * automation consults before it may open or apply a threshold change. Nothing
 * here changes a threshold itself, and an unreadable or thin population records
 * "not confirmed" — never a confirmation by default.
 *
 * Runs on the existing hourly shadow-resolve pass, just before automation. No
 * new schedule, no second copy of the data.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  evaluateWalkForward,
  type WalkForwardObservation,
  type WalkForwardResult,
} from "@/lib/stats/walk-forward";

/** Maturity horizon, matching `recompute_filter_lift`. */
export const MATURITY_HOURS = 24;
/** Bound on rows read per pass. */
const ROW_LIMIT = 5000;

interface CandidateRow {
  detected_at: string;
  instrument: string;
  resolved_outcome: string | null;
  data_quality_outcome: string | null;
  realized_r: number | string | null;
  research_candidates: { gates: unknown } | { gates: unknown }[] | null;
}

/**
 * Effective R under the same classification filter lift uses: an invalid plan is
 * excluded outright, a gap beyond the stop or an unfilled plan counts as no
 * trade (0R), everything else uses the replayed R.
 */
function effectiveR(row: CandidateRow): number | null {
  if (row.data_quality_outcome === "invalid_plan") return null;
  if (row.data_quality_outcome === "gap_beyond_stop") return 0;
  if (row.resolved_outcome === "never_filled") return 0;
  const r = row.realized_r === null ? null : Number(row.realized_r);
  return r === null || !Number.isFinite(r) ? null : r;
}

export interface WalkForwardPassResult {
  ran: boolean;
  error?: string | undefined;
  gates?: Record<string, WalkForwardResult> | undefined;
}

/** Group the read rows into per-gate observation sets. */
export function toGateObservations(
  rows: CandidateRow[],
  nowMs: number,
): Record<string, WalkForwardObservation[]> {
  const byGate: Record<string, WalkForwardObservation[]> = {};
  for (const row of rows) {
    const detected = Date.parse(row.detected_at);
    if (!Number.isFinite(detected)) continue;
    if (detected + MATURITY_HOURS * 3_600_000 > nowMs) continue; // not matured yet
    const r = effectiveR(row);
    if (r === null) continue;

    const candidate = Array.isArray(row.research_candidates)
      ? row.research_candidates[0]
      : row.research_candidates;
    const gates = candidate?.gates;
    if (!Array.isArray(gates)) continue;

    const day = new Date(detected).toISOString().slice(0, 10);
    for (const entry of gates as { gate?: unknown; outcome?: unknown }[]) {
      const gate = typeof entry?.gate === "string" ? entry.gate : null;
      const outcome = entry?.outcome === "pass" || entry?.outcome === "fail" ? entry.outcome : null;
      if (!gate || !outcome) continue;
      (byGate[gate] ??= []).push({
        day,
        cluster: `${day}|${row.instrument}`,
        arm: outcome,
        r,
      });
    }
  }
  return byGate;
}

export async function runWalkForwardPass(
  db: SupabaseClient,
  now: number = Date.now(),
): Promise<WalkForwardPassResult> {
  let rows: CandidateRow[];
  try {
    const { data, error } = await db
      .from("shadow_executions")
      .select(
        "detected_at, instrument, resolved_outcome, data_quality_outcome, realized_r, research_candidates!inner(gates)",
      )
      .eq("cohort", "research_candidate")
      .eq("plan_origin", "counterfactual")
      .eq("replay_version", 1)
      .eq("execution_policy", "legacy_best_target_touched")
      .eq("status", "resolved")
      .order("detected_at", { ascending: true })
      .limit(ROW_LIMIT);
    if (error) throw new Error(error.message);
    rows = (data ?? []) as unknown as CandidateRow[];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[walk-forward] read failed:", message);
    return { ran: false, error: message };
  }

  const byGate = toGateObservations(rows, now);
  const gates: Record<string, WalkForwardResult> = {};
  const records: Record<string, unknown>[] = [];
  for (const [gate, observations] of Object.entries(byGate)) {
    const result = evaluateWalkForward(observations);
    gates[gate] = result;
    records.push({
      gate,
      confirmed: result.confirmed,
      split_day: result.splitDay,
      train_days: result.train?.days ?? 0,
      holdout_days: result.holdout?.days ?? 0,
      train_pass_n: result.train?.pass.n ?? 0,
      train_fail_n: result.train?.fail.n ?? 0,
      holdout_pass_n: result.holdout?.pass.n ?? 0,
      holdout_fail_n: result.holdout?.fail.n ?? 0,
      train_delta_r: result.train?.deltaR ?? null,
      holdout_delta_r: result.holdout?.deltaR ?? null,
      holdout_low: result.holdout?.low ?? null,
      holdout_high: result.holdout?.high ?? null,
      blockers: result.blockers,
      detail: result.detail,
      computed_at: new Date(now).toISOString(),
    });
  }

  if (records.length > 0) {
    const { error } = await db
      .from("walk_forward_confirmations")
      .upsert(records as never, { onConflict: "gate" });
    if (error) {
      console.error("[walk-forward] write failed:", error.message);
      return { ran: false, error: error.message, gates };
    }
  }

  return { ran: true, gates };
}
