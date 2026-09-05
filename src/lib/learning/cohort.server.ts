/**
 * Reads the resolved replay history that {@link buildCohortEvidence} measures.
 *
 * Only rows the replay engine actually resolved on real candles are read. A row
 * with no resolved outcome, or with no R to read, is skipped rather than
 * defaulted — an unmeasured cohort must stay unmeasured.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildCohortEvidence, type CohortEvidence, type CohortObservation } from "./cohort";

/** Bounded read: the harness is a background rule, not a report. */
const ROW_LIMIT = 5000;

export interface CohortEvidenceSnapshot {
  evidence: Map<string, CohortEvidence>;
  /** False when the read failed. Callers must then refuse nothing. */
  readable: boolean;
  rows: number;
}

export async function loadCohortEvidence(
  db: SupabaseClient,
): Promise<CohortEvidenceSnapshot> {
  const { data, error } = await db
    .from("shadow_executions")
    .select(
      "detected_at, instrument, direction, trading_session, resolved_outcome, gross_r, realized_r",
    )
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
    const outcome = row["resolved_outcome"];
    if (outcome !== "win" && outcome !== "loss" && outcome !== "expired") continue;
    const raw = row["gross_r"] ?? row["realized_r"];
    const r = raw === null || raw === undefined ? NaN : Number(raw);
    if (!Number.isFinite(r)) continue;
    const detectedAt = row["detected_at"];
    const instrument = row["instrument"];
    const direction = row["direction"];
    if (typeof detectedAt !== "string" || typeof instrument !== "string") continue;
    if (typeof direction !== "string" || direction.length === 0) continue;
    const session = row["trading_session"];
    observations.push({
      r,
      at: detectedAt,
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
