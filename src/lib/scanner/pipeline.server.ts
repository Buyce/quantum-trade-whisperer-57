/**
 * Queue pipeline: one invocation processes exactly ONE (instrument) job so no
 * single request approaches any CPU/memory ceiling. Each stage is independent
 * and idempotent; failures flag the instrument and move on.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildTradeProfile } from "./profile";
import { fetchCandles, MetaApiNotConfiguredError, MetaApiTimeoutError } from "./metaapi.server";
import { CANDLE_LIMITS, DEFAULT_DAILY_SETUP_CAP, INSTRUMENTS, type Candle, type Timeframe } from "./types";

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

/** Enqueue one job per monitored instrument for this scan cycle. */
export async function enqueueScanCycle(db: SupabaseClient) {
  const runId = crypto.randomUUID();
  const rows = INSTRUMENTS.map((instrument) => ({
    run_id: runId,
    instrument,
    status: "pending",
  }));
  const { error } = await db.from("scan_queue").insert(rows);
  if (error) throw error;
  return { runId, enqueued: rows.length };
}

async function countToday(db: SupabaseClient) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { count, error } = await db
    .from("scanned_signals")
    .select("id", { count: "exact", head: true })
    .gte("detected_at", start.toISOString());
  if (error) throw error;
  return count ?? 0;
}

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
  status: "published" | "no_trade" | "skipped" | "capped" | "failed";
  detail?: string;
}

/** Claim and process a single pending job. Returns null when the queue is empty. */
export async function processNextJob(db: SupabaseClient): Promise<JobResult | null> {
  const { data: claimed, error: claimError } = await db.rpc("claim_scan_job");
  if (claimError) throw claimError;
  const job = (Array.isArray(claimed) ? claimed[0] : claimed) as
    | { id: string; instrument: string }
    | undefined
    | null;
  if (!job) return null;

  const finish = async (status: JobResult["status"], detail?: string) => {
    await db
      .from("scan_queue")
      .update({
        status: status === "failed" ? "failed" : "done",
        result: status,
        error: detail ?? null,
        processed_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return { jobId: job.id, instrument: job.instrument, status, ...(detail ? { detail } : {}) };
  };

  try {
    if ((await countToday(db)) >= DEFAULT_DAILY_SETUP_CAP) {
      return await finish("capped", `Daily cap of ${DEFAULT_DAILY_SETUP_CAP} setups already reached`);
    }

    // Sequential per-timeframe fetch keeps peak memory to one candle series.
    const candles = {} as Record<Timeframe, Candle[]>;
    for (const tf of TIMEFRAMES) {
      candles[tf] = await fetchCandles(job.instrument, tf, CANDLE_LIMITS[tf]);
    }
    await clearInstrument(db, job.instrument);

    const profile = buildTradeProfile({ instrument: job.instrument, candles: candles });
    if (!profile) return await finish("no_trade", "No structure satisfied the ABC grading rules");

    const now = new Date();
    const m15Atr = profile.atr;
    const h1Atr = candles.H1.length ? Math.abs(candles.H1[candles.H1.length - 1]!.close) : 0;

    const { data: ctx, error: ctxError } = await db
      .from("market_context")
      .insert({
        trading_session: sessionOf(now),
        volatility_index: Number((h1Atr > 0 ? (m15Atr / h1Atr) * 1000 : 1).toFixed(4)),
        time_of_day: now.getUTCHours(),
        day_of_week: now.getUTCDay(),
      })
      .select("id")
      .single();
    if (ctxError) throw ctxError;

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
        market_context_id: (ctx as { id: string }).id,
        detected_at: now.toISOString(),
        status: "active",
        resolved_outcome: "open",
      })
      .select("id")
      .single();
    if (sigError) throw sigError;

    const { sendSignalAlerts } = await import("./alerts.server");
    await sendSignalAlerts(db, {
      id: (inserted as { id: string }).id,
      instrument: profile.instrument,
      grade: profile.grade,
      direction: profile.direction,
      entryPrice: profile.entryPrice,
      stopLoss: profile.stopLoss,
      tp1: profile.tp1,
      tp2: profile.tp2,
      tp3: profile.tp3,
      rrRatio: profile.rrRatio,
      confidence: profile.confidence.score,
      breakdown: profile.qualitativeBreakdown,
      session: sessionOf(now),
    });

    return await finish("published", `${profile.grade}-grade ${profile.direction}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof MetaApiTimeoutError || err instanceof MetaApiNotConfiguredError) {
      // Graceful abort: flag the instrument, skip it, let the next job run.
      await flagInstrument(db, job.instrument, message);
      return await finish("skipped", message);
    }
    await flagInstrument(db, job.instrument, message);
    return await finish("failed", message);
  }
}
