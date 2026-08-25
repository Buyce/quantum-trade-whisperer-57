/**
 * Why an automatic order was — or was not — queued.
 *
 * Before this log existed the enqueue outcome only appeared in server logs, so
 * "the ledger is empty" was indistinguishable from "the engine never tried".
 * Every publication now records its decision, including the refusals, so the
 * user's own summary and the admin terminal can state a fact instead of a guess.
 *
 * Writing is strictly best-effort: this module never throws into the publication
 * path, because a diagnostic write must not be able to affect a publish.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export { describeEnqueueDecision, ENQUEUE_DECISION_COPY } from "./enqueue-log";

export interface EnqueueDecisionRow {
  /** NULL = a system-wide decision that concerns no single user. */
  user_id: string | null;
  signal_id: string | null;
  instrument: string | null;
  grade: string | null;
  decision: string;
  detail: string | null;
  enqueued: number;
  filtered: number;
}

export async function recordEnqueueDecisions(
  db: SupabaseClient,
  rows: EnqueueDecisionRow[],
): Promise<void> {
  if (rows.length === 0) return;
  try {
    const { error } = await db.from("execution_enqueue_decisions").insert(rows as never);
    if (error) console.error("[enqueue-log] write failed:", error.message);
  } catch (err) {
    console.error("[enqueue-log] write threw:", err instanceof Error ? err.message : String(err));
  }
}
