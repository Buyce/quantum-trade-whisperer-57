/**
 * Shadow enrolment worker.
 *
 * Claims one job at a time from `shadow_queue` (populated by an in-transaction
 * trigger on `scanned_signals`) and snapshots the setup into
 * `shadow_executions`. Completely decoupled from the live scan path: the live
 * pipeline only performs one extra in-transaction insert and never awaits this.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ShadowJobResult {
  queueId: number;
  signalId: string;
  result: "enrolled" | "duplicate" | "missing" | "failed";
  error?: string;
}

export async function isShadowPaused(db: SupabaseClient): Promise<boolean> {
  const { data } = await db.from("shadow_engine_state").select("paused").eq("id", true).maybeSingle();
  return Boolean(data?.paused);
}

export async function noteShadowRun(
  db: SupabaseClient,
  patch: { failure?: boolean; error?: string | null },
) {
  const { data } = await db
    .from("shadow_engine_state")
    .select("consecutive_failures")
    .eq("id", true)
    .maybeSingle();
  const current = Number(data?.consecutive_failures ?? 0);
  const failures = patch.failure ? current + 1 : 0;
  await db
    .from("shadow_engine_state")
    .update({
      consecutive_failures: failures,
      // Five consecutive failed passes means the data source, not one setup, is
      // broken. Pause rather than hammer MetaApi every hour.
      paused: failures >= 5,
      last_error: patch.error ?? null,
      last_run_at: new Date().toISOString(),
    })
    .eq("id", true);
}

/** Claim and enrol exactly one queued signal. Returns null when the queue is empty. */
export async function processNextShadowJob(db: SupabaseClient): Promise<ShadowJobResult | null> {
  const { data: claimed, error: claimError } = await db.rpc("claim_shadow_job");
  if (claimError) throw new Error(`claim_shadow_job failed: ${claimError.message}`);
  const job = Array.isArray(claimed) ? claimed[0] : claimed;
  if (!job) return null;

  const queueId = Number(job.id);
  const signalId = String(job.signal_id);

  try {
    const { data: signal, error: signalError } = await db
      .from("scanned_signals")
      .select(
        "id, detected_at, instrument, grade, direction, entry_price, stop_loss, tp1, tp2, tp3, tp1_r, tp2_r, max_r, confidence_score",
      )
      .eq("id", signalId)
      .maybeSingle();
    if (signalError) throw new Error(signalError.message);

    if (!signal) {
      await finish(db, queueId, "missing", "signal no longer exists");
      return { queueId, signalId, result: "missing" };
    }

    const risk = Math.abs(Number(signal.entry_price) - Number(signal.stop_loss));
    const { error: insertError } = await db.from("shadow_executions").insert({
      signal_id: signal.id,
      instrument: signal.instrument,
      grade: signal.grade,
      direction: signal.direction,
      detected_at: signal.detected_at,
      entry_price: signal.entry_price,
      stop_loss: signal.stop_loss,
      tp1: signal.tp1,
      tp2: signal.tp2,
      tp3: signal.tp3,
      tp1_r: signal.tp1_r,
      tp2_r: signal.tp2_r,
      max_r: signal.max_r,
      risk_price: risk,
      confidence_score: signal.confidence_score,
      status: "open",
      replay_cursor: signal.detected_at,
    });

    // 23505 = unique violation on signal_id: already enrolled, which is a
    // success for an idempotent worker, not an error.
    if (insertError && insertError.code !== "23505") throw new Error(insertError.message);

    const result = insertError ? "duplicate" : "enrolled";
    await finish(db, queueId, result, null);
    return { queueId, signalId, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finish(db, queueId, "failed", message);
    return { queueId, signalId, result: "failed", error: message };
  }
}

async function finish(db: SupabaseClient, queueId: number, result: string, error: string | null) {
  await db
    .from("shadow_queue")
    .update({
      status: result === "failed" ? "failed" : "done",
      result,
      error,
      finished_at: new Date().toISOString(),
    })
    .eq("id", queueId);
}
