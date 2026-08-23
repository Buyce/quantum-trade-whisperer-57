/**
 * Shadow enrolment worker.
 *
 * Claims one job at a time from `shadow_queue` (populated by an in-transaction
 * trigger on `scanned_signals`) and snapshots the setup into
 * `shadow_executions`. Completely decoupled from the live scan path: the live
 * pipeline only performs one extra in-transaction insert and never awaits this.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTIVE_MODEL_VERSION } from "@/lib/versioning";

export interface ShadowJobResult {
  queueId: number;
  signalId: string;
  result: "enrolled" | "duplicate" | "missing" | "failed";
  error?: string;
}

/**
 * How long the breaker stays closed after it trips before one probe pass is
 * allowed through. A tripped breaker used to be terminal: the resolve pass
 * returned early *before* it could ever record a success, so `paused` stayed
 * true (and `consecutive_failures` stuck at 5) until someone edited the row by
 * hand. The cooldown keeps the "stop hammering a dead data source" intent while
 * letting the engine heal itself once the source recovers.
 */
export const SHADOW_BREAKER_COOLDOWN_MS = 60 * 60 * 1000;

export interface ShadowBreakerGate {
  /** True when this pass may run (either not paused, or a probe is due). */
  allowed: boolean;
  /** True when this is a single probe pass through a still-tripped breaker. */
  probe: boolean;
  paused: boolean;
  pausedUntil: string | null;
  consecutiveFailures: number;
}

export async function isShadowPaused(db: SupabaseClient): Promise<boolean> {
  const gate = await shadowBreakerGate(db);
  return !gate.allowed;
}

/**
 * Reads the breaker and decides whether this pass runs. A paused breaker whose
 * cooldown has elapsed yields `{ allowed: true, probe: true }` — exactly one
 * pass is let through; if it fails, `noteShadowRun` extends the cooldown.
 */
export async function shadowBreakerGate(db: SupabaseClient): Promise<ShadowBreakerGate> {
  const { data } = await db
    .from("shadow_engine_state")
    .select("paused, paused_until, consecutive_failures")
    .eq("id", true)
    .maybeSingle();

  const paused = Boolean(data?.paused);
  const pausedUntil = (data?.paused_until as string | null) ?? null;
  const consecutiveFailures = Number(data?.consecutive_failures ?? 0);
  if (!paused) return { allowed: true, probe: false, paused, pausedUntil, consecutiveFailures };

  // Missing cooldown (rows tripped before this column existed) counts as due.
  const dueAt = pausedUntil ? Date.parse(pausedUntil) : 0;
  const due = !Number.isFinite(dueAt) || Date.now() >= dueAt;
  return { allowed: due, probe: due, paused, pausedUntil, consecutiveFailures };
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
  // Five consecutive failed passes means the data source, not one setup, is
  // broken. Trip the breaker rather than hammer MetaApi every hour — but stamp
  // a cooldown so a later pass can probe and clear it automatically.
  const paused = failures >= 5;
  await db
    .from("shadow_engine_state")
    .update({
      consecutive_failures: failures,
      paused,
      paused_until: paused
        ? new Date(Date.now() + SHADOW_BREAKER_COOLDOWN_MS).toISOString()
        : null,
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
        "id, detected_at, instrument, grade, direction, entry_price, stop_loss, tp1, tp2, tp3, tp1_r, tp2_r, tp3_r, max_r, confidence_score, atr, model_version, observation_key",
      )
      .eq("id", signalId)
      .maybeSingle();
    if (signalError) throw new Error(signalError.message);

    if (!signal) {
      await finish(db, queueId, "missing", "signal no longer exists");
      return { queueId, signalId, result: "missing" };
    }

    // Feature snapshot: these are copied onto the row, not read through the FK,
    // so tiered retention deleting the signal cannot destroy the training set.
    const { data: ctx } = await db
      .from("market_context")
      .select("trading_session, volatility_index")
      .eq("signal_id", signalId)
      .maybeSingle();

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
      tp3_r: signal.tp3_r,
      max_r: signal.max_r,
      risk_price: risk,
      confidence_score: signal.confidence_score,
      atr: signal.atr,
      trading_session: ctx?.trading_session ?? null,
      volatility_index: ctx?.volatility_index ?? null,
      status: "open",
      replay_cursor: signal.detected_at,
      // Inherited from the signal, never defaulted here: a shadow row must
      // always report the model version that actually produced the setup.
      model_version:
        (signal as { model_version?: number | null }).model_version ?? ACTIVE_MODEL_VERSION,
      observation_key: (signal as { observation_key?: string | null }).observation_key ?? null,
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
