/**
 * Reads the resolved replay history that {@link buildCohortEvidence} measures.
 *
 * SCOPING (load-bearing): this read is pinned to the PRODUCTION cohort, Replay
 * V1 and the legacy execution policy, exactly like every sibling reader of
 * `shadow_executions`. Without those predicates a research-candidate outcome or
 * a corrected-policy (V2) outcome would pool into the same population, and this
 * population can refuse a live order — mixing replay versions or cohorts here
 * would silently change what gets sent to a broker.
 *
 * ESTIMAND: the per-plan estimand defined in `payoff.ts` — a plan that never
 * traded (never filled, or an entry-side gap beyond the stop) counts as exactly
 * 0R, and a broken observation (`invalid_plan`) is excluded from the denominator
 * rather than scored. Dropping the no-trade rows instead would flatter
 * expectancy on the very population used to refuse orders.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  EXECUTION_POLICY_LEGACY,
  REPLAY_V1_VERSION,
} from "@/lib/execution/replay-registry";
import { buildCohortEvidence, type CohortEvidence, type CohortObservation } from "./cohort";

/** Bounded read: the harness is a background rule, not a report. */
const ROW_LIMIT = 5000;

/** Production replay cohort label, matching the resolver. */
const PRODUCTION_COHORT = "production";

export interface CohortEvidenceSnapshot {
  evidence: Map<string, CohortEvidence>;
  /** False when the read failed. Callers must then refuse nothing. */
  readable: boolean;
  rows: number;
}

/**
 * Per-plan effective R. `null` means "exclude", never "zero".
 * Mirrors `effectiveR` in `learning/walk-forward.server.ts` and the
 * `mean_r_per_plan` estimand in `learning/payoff.ts`.
 */
export function perPlanR(row: {
  data_quality_outcome?: unknown;
  resolved_outcome?: unknown;
  gross_r?: unknown;
  realized_r?: unknown;
}): number | null {
  if (row.data_quality_outcome === "invalid_plan") return null;
  if (row.data_quality_outcome === "gap_beyond_stop") return 0;
  if (row.resolved_outcome === "never_filled") return 0;
  const raw = row.gross_r ?? row.realized_r;
  const r = raw === null || raw === undefined ? NaN : Number(raw);
  return Number.isFinite(r) ? r : null;
}

export async function loadCohortEvidence(
  db: SupabaseClient,
): Promise<CohortEvidenceSnapshot> {
  const { data, error } = await db
    .from("shadow_executions")
    .select(
      "detected_at, instrument, direction, trading_session, resolved_outcome, data_quality_outcome, gross_r, realized_r",
    )
    .eq("cohort", PRODUCTION_COHORT)
    .eq("replay_version", REPLAY_V1_VERSION)
    .eq("execution_policy", EXECUTION_POLICY_LEGACY)
    .not("resolved_outcome", "is", null)
    .order("detected_at", { ascending: false })
    .limit(ROW_LIMIT);

  if (error) {
    // An unreadable history is NOT evidence of a bad cohort. Refuse nothing.
    console.error("cohort evidence unreadable", error.message);
    return { evidence: new Map(), readable: false, rows: 0 };
  }

  const observations: CohortObservation[] = [];
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const r = perPlanR(row);
    if (r === null) continue;
    const detectedAt = row["detected_at"];
    const instrument = row["instrument"];
    const direction = row["direction"];
    if (typeof detectedAt !== "string" || typeof instrument !== "string") continue;
    if (typeof direction !== "string" || direction.length === 0) continue;
    const session = row["trading_session"];
    const id = `${instrument}|${direction}|${detectedAt}|${observations.length}`;
    observations.push({
      id,
      r,
      detectedAt,
      instrument,
      direction,
      session: typeof session === "string" && session.length > 0 ? session : null,
    });
  }

  return {
    evidence: buildCohortEvidence(observations),
    readable: true,
    rows: observations.length,
  };
}

