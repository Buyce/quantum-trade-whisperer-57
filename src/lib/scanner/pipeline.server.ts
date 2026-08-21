/**
 * Queue pipeline: one invocation processes exactly ONE (instrument) job so no
 * single request approaches any CPU/memory ceiling. Each stage is independent
 * and idempotent; failures flag the instrument and move on.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildTradeProfile } from "./profile";
import { atr } from "./indicators";
import { ACTIVE_MODEL_VERSION, observationKey } from "@/lib/versioning";
import { fetchCandles, MetaApiNotConfiguredError, MetaApiTimeoutError } from "./metaapi.server";
import {
  CANDLE_LIMITS,
  ENTRY_PRICE_DECIMALS,
  INSTRUMENTS,
  SIGNAL_MAX_AGE_HOURS,
  STRUCTURE_COOLDOWN_MINUTES,
  type Candle,
  type Timeframe,
} from "./types";

const TIMEFRAMES: Timeframe[] = ["H4", "H1", "M15"];

export function adminClient(): SupabaseClient {
  return createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_SERVICE_ROLE_KEY"]!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function sessionOf(date: Date): string {
  const h = date.getUTCHours();
  if (h >= 22 || h < 1) return "sydney";
  if (h < 7) return "tokyo";
  if (h < 12) return "london";
  if (h < 16) return "london_new_york_overlap";
  if (h < 22) return "new_york";
  return "sydney";
}

/**
 * Retire setups that are still `active` past their lifetime. They no longer
 * reflect live structure, and clearing them lets a genuinely fresh version of
 * the same setup publish again. Only touches rows the scanner itself wrote;
 * resolved signals and user-logged trades are untouched.
 */
export async function expireStaleSignals(db: SupabaseClient): Promise<{
  expired: number;
  error: string | null;
}> {
  const cutoff = new Date(Date.now() - SIGNAL_MAX_AGE_HOURS * 3_600_000).toISOString();
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("scanned_signals")
    .update({ status: "expired", expired_at: now })
    .eq("status", "active")
    .lt("detected_at", cutoff)
    .select("id");
  if (error) {
    // Surfaced, not swallowed: "0 expired" and "the expire query broke" must be
    // distinguishable in the cron response, or a wedged retention pass is invisible.
    const message = describeError(error);
    console.error("[pipeline] expireStaleSignals failed:", message);
    return { expired: 0, error: message };
  }
  return { expired: (data ?? []).length, error: null };
}

/** Enqueue one job per monitored instrument for this scan cycle. */
export async function enqueueScanCycle(db: SupabaseClient) {
  const { expired, error: expireError } = await expireStaleSignals(db);
  const runId = crypto.randomUUID();
  const rows = INSTRUMENTS.map((instrument) => ({
    run_id: runId,
    instrument,
    status: "pending",
  }));
  const { error } = await db.from("scan_queue").insert(rows);
  if (error) throw error;
  return { runId, enqueued: rows.length, expired, expireError };
}


/**
 * Duplicate suppression is enforced by the partial unique index
 * `scanned_signals_active_unique` on (instrument, direction, round(entry_price, 5))
 * WHERE status = 'active'. The pre-flight SELECT that used to live here pulled up
 * to 200 rows per job to reach the same verdict the index reaches for free, and
 * it could not close the race window anyway — so the insert's 23505 is now the
 * single source of truth.
 */

/** Serialize thrown values — Supabase/PostgREST errors are plain objects, not Errors. */
export function describeError(err: unknown): string {

  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const e = err as { message?: string; code?: string; details?: string; hint?: string };
    const parts = [
      e.code ? `[${e.code}]` : null,
      e.message ?? null,
      e.details ?? null,
      e.hint ? `hint: ${e.hint}` : null,
    ].filter(Boolean);
    if (parts.length) return parts.join(" ");
    try {
      return JSON.stringify(err);
    } catch {
      return "Unserializable error object";
    }
  }
  return String(err);
}

async function writeHealth(
  db: SupabaseClient,
  row: {
    instrument: string;
    available: boolean;
    last_error: string | null;
    unavailable_until: string | null;
  },
) {
  const { error } = await db
    .from("instrument_health")
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "instrument" });
  if (error) console.error("[pipeline] instrument_health write failed:", describeError(error));
}

async function flagInstrument(db: SupabaseClient, instrument: string, message: string) {
  await writeHealth(db, {
    instrument,
    available: false,
    last_error: message.slice(0, 500),
    unavailable_until: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
}

async function clearInstrument(db: SupabaseClient, instrument: string) {
  await writeHealth(db, {
    instrument,
    available: true,
    last_error: null,
    unavailable_until: null,
  });
}


export interface JobResult {
  jobId: string;
  instrument: string;
  status: "published" | "no_trade" | "skipped" | "duplicate" | "failed" | "stale";
  detail?: string;
}

/** Jobs still waiting. Drives the worker's self-chain decision. */
export async function pendingScanJobs(db: SupabaseClient): Promise<number> {
  const { count, error } = await db
    .from("scan_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) throw error;
  return count ?? 0;
}

/**
 * A job enqueued more than one scan interval ago is worthless: its cycle has
 * been superseded, and grading live candles against it burns the whole request
 * budget while producing a duplicate of the current structure. Drop it fast so
 * the newest cycle reaches the front of the queue.
 */
const JOB_STALE_AFTER_MS = 15 * 60_000;

/** Claim and process a single pending job. Returns null when the queue is empty. */
export async function processNextJob(db: SupabaseClient): Promise<JobResult | null> {
  const { data: claimed, error: claimError } = await db.rpc("claim_scan_job");
  if (claimError) throw claimError;
  const job = (Array.isArray(claimed) ? claimed[0] : claimed) as
    | { id: string; instrument: string; enqueued_at?: string | null; run_id?: string | null }
    | undefined
    | null;
  if (!job) return null;

  const finish = async (status: JobResult["status"], detail?: string) => {
    const stamp = new Date().toISOString();
    await db
      .from("scan_queue")
      .update({
        status: status === "failed" ? "failed" : "done",
        result: status,
        error: detail ?? null,
        processed_at: stamp,
        finished_at: stamp,
      })
      .eq("id", job.id);
    return { jobId: job.id, instrument: job.instrument, status, ...(detail ? { detail } : {}) };
  };

  if (job.enqueued_at) {
    const ageMs = Date.now() - new Date(job.enqueued_at).getTime();
    if (ageMs > JOB_STALE_AFTER_MS) {
      return await finish(
        "stale",
        `Backlogged ${Math.round(ageMs / 60_000)} minutes past its scan interval; closed without fetching candles`,
      );
    }
  }


  try {
    // Sequential per-timeframe fetch keeps peak memory to one candle series.
    const candles = {} as Record<Timeframe, Candle[]>;
    for (const tf of TIMEFRAMES) {
      candles[tf] = await fetchCandles(job.instrument, tf, CANDLE_LIMITS[tf]);
    }
    await clearInstrument(db, job.instrument);

    // Session is resolved before grading so the entry math and the
    // market_context row can never disagree about which regime this setup is in.
    const now = new Date();
    const session = sessionOf(now);

    const profile = buildTradeProfile({ instrument: job.instrument, candles, session });
    if (!profile) return await finish("no_trade", "No structure satisfied the ABC grading rules");

    // No global ceiling: every qualifying setup publishes. Each account applies
    // its own daily cap (scanner_settings.daily_setup_cap, 0 = unlimited) to
    // what it sees and is alerted about.



    // Structure cooldown: the same ABC leg may not republish inside this
    // window even after the previous instance expired or resolved. This is what
    // stops one lingering structure firing every 15 minutes.
    const cooldownFrom = new Date(
      Date.now() - STRUCTURE_COOLDOWN_MINUTES * 60_000,
    ).toISOString();
    const { data: recentSame, error: cooldownError } = await db
      .from("scanned_signals")
      .select("id")
      .eq("structure_key", profile.structureKey)
      .gte("detected_at", cooldownFrom)
      .limit(1);
    if (cooldownError) throw cooldownError;
    if ((recentSame ?? []).length) {
      return await finish(
        "duplicate",
        `Same structure already published within the last ${STRUCTURE_COOLDOWN_MINUTES} minutes`,
      );
    }

    // Volatility regime = M15 ATR relative to H1 ATR. Both must be true ATRs;
    // dividing by a raw close price (the previous behaviour) is meaningless.
    const m15Atr = profile.atr;
    const h1Atr = atr(candles.H1, 14);
    const volatilityIndex =
      h1Atr > 0 && m15Atr > 0 ? Number((m15Atr / h1Atr).toFixed(4)) : null;

    // Advisory Bayesian prior from the shadow telemetry. Recorded on the row for
    // observation only: nothing below branches on it, so a stale or empty
    // regime_stats table cannot change which setups publish.
    const { priorFor } = await import("@/lib/learning/regime.server");
    const prior = await priorFor(db, {
      instrument: profile.instrument,
      direction: profile.direction,
      session,
      volatilityIndex,
    });


    // Signal first — market_context.signal_id is required and references it.
    const { data: inserted, error: sigError } = await db
      .from("scanned_signals")
      .insert({
        instrument: profile.instrument,
        grade: profile.grade,
        direction: profile.direction,
        entry_price: profile.entryPrice,
        stop_loss: profile.stopLoss,
        tp1: profile.tp1,
        tp2: profile.tp2,
        tp3: profile.tp3,
        tp1_r: profile.tp1R,
        tp2_r: profile.tp2R,
        tp3_r: profile.tp3R,
        max_r: profile.maxR,
        max_acceptable_entry: profile.maxAcceptableEntry,
        structure_key: profile.structureKey,
        atr: profile.atr,
        rr_ratio: profile.rrRatio,
        confidence_score: profile.confidence.score,
        c_alignment: profile.confidence.alignment,
        c_rr: profile.confidence.rr,
        c_symmetry: profile.confidence.symmetry,
        c_volatility: profile.confidence.volatility,
        pattern_symmetry: profile.patternSymmetry,
        p_trend: profile.pillars.trend,
        p_order_block: profile.pillars.orderBlock,
        p_momentum: profile.pillars.momentum,
        p_volatility_expansion: profile.pillars.volatilityExpansion,
        pillars_passed: profile.pillars.passed,
        h4_bias: profile.h4Bias,
        h1_bias: profile.h1Bias,
        m15_bias: profile.m15Bias,
        qualitative_breakdown: profile.qualitativeBreakdown,
        detected_at: now.toISOString(),
        status: "active",
        resolved_outcome: "open",
        p_fill_prior: prior?.pFill ?? null,
        p_win_prior: prior?.pWin ?? null,
        ev_prior: prior?.ev ?? null,
        prior_sample_n: prior?.sampleN ?? null,
        prior_filled_n: prior?.filledN ?? null,
        prior_tier: prior?.tier ?? null,
        // Cohort identity + pairing key. The key ties this row to the exact
        // scan-cycle read of this instrument, so a future corrected model
        // evaluated on the same candles can be compared observation by
        // observation instead of in aggregate.
        model_version: ACTIVE_MODEL_VERSION,
        observation_key: observationKey(job.run_id, job.instrument),
      })
      .select("id")
      .single();
    if (sigError) {
      // 23505 = the active-setup unique index caught a concurrent duplicate.
      if ((sigError as { code?: string }).code === "23505") {
        return await finish("duplicate", "An identical active setup is already published");
      }
      throw sigError;
    }

    const signalId = (inserted as { id: string }).id;

    const { error: ctxError } = await db.from("market_context").insert({
      signal_id: signalId,
      trading_session: session,
      volatility_index: volatilityIndex,
      time_of_day: now.getUTCHours(),
      day_of_week: now.getUTCDay(),
    });
    if (ctxError) {
      // Compensating rollback: a signal with no context would sit in the feed
      // forever as a half-written ghost row while the job reads as "failed".
      // Remove it so the next cycle can publish the structure cleanly.
      const { error: cleanupError } = await db.from("scanned_signals").delete().eq("id", signalId);
      const detail = `Market context write failed, signal rolled back: ${describeError(ctxError)}${
        cleanupError ? ` (rollback also failed: ${describeError(cleanupError)})` : ""
      }`;
      console.error(`[pipeline] ${job.instrument}`, detail);
      return await finish("failed", detail);
    }

    // Both rows are committed: the setup is published no matter what email does.
    // An alert failure must never re-label a successful publish as failed.
    try {
      const { sendSignalAlerts } = await import("./alerts.server");
      await sendSignalAlerts(db, {
        id: signalId,
        instrument: profile.instrument,
        grade: profile.grade,
        direction: profile.direction,
        entryPrice: profile.entryPrice,
        maxAcceptableEntry: profile.maxAcceptableEntry,
        stopLoss: profile.stopLoss,
        tp1: profile.tp1,
        tp2: profile.tp2,
        tp3: profile.tp3,
        tp1R: profile.tp1R,
        tp2R: profile.tp2R,
        tp3R: profile.tp3R,
        rrRatio: profile.rrRatio,
        confidence: profile.confidence.score,
        breakdown: profile.qualitativeBreakdown,
        session: sessionOf(now),
      });
    } catch (alertErr) {
      console.error(`[pipeline] ${job.instrument} alert fan-out failed:`, describeError(alertErr));
    }

    return await finish("published", `${profile.grade}-grade ${profile.direction}`);
  } catch (err) {
    const message = describeError(err);
    console.error(`[pipeline] ${job.instrument} failed:`, message);

    // A unique-index collision is a benign duplicate, never a failure.
    if ((err as { code?: string } | null)?.code === "23505") {
      return await finish("duplicate", "An identical active setup is already published");
    }

    if (err instanceof MetaApiTimeoutError || err instanceof MetaApiNotConfiguredError) {
      // Graceful abort: flag the instrument, skip it, let the next job run.
      // Retry is deliberately deferred to the next 15-minute cycle rather than
      // hammering the broker inside a known timeout window.
      await flagInstrument(db, job.instrument, message);
      return await finish("skipped", message);
    }
    await flagInstrument(db, job.instrument, message);
    return await finish("failed", message);
  }
}
