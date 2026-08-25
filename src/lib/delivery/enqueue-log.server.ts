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

/** Plain-language rendering of a decision, shared by the user summary and admin. */
export const ENQUEUE_DECISION_COPY: Record<string, string> = {
  enqueued: "Queued for your armed account.",
  c_grade_never_executes: "C-Grade setups are never executed automatically.",
  automatic_execution_disabled: "Automatic execution is currently switched off system-wide.",
  no_armed_account: "No account is armed for automatic orders.",
  no_settings_row: "Your rules could not be read, so no order was placed.",
  instrument_filtered: "This instrument is not in your selected instruments.",
  session_filtered: "This setup's session is not in your selected sessions.",
  below_alert_grade: "This setup's grade is below your minimum tier.",
  below_min_grade: "This setup's grade is below your minimum tier.",
  expired_retention: "The setup had already expired.",
  daily_cap_reached: "Your trades-per-day limit was already used up.",
  intelligence_gate_below_threshold:
    "The historical win-if-filled rate for this regime is below your intelligence-gate threshold.",
  intelligence_gate_sample_insufficient:
    "Too few resolved replay samples behind this regime to satisfy your intelligence gate.",
};

export function describeEnqueueDecision(decision: string): string {
  if (ENQUEUE_DECISION_COPY[decision]) return ENQUEUE_DECISION_COPY[decision] as string;
  if (decision.startsWith("enqueue_failed"))
    return "The order could not be queued because of a database error.";
  if (decision.endsWith("unreadable"))
    return "A required record could not be read, so nothing was queued.";
  return decision;
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
