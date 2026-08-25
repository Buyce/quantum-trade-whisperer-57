/**
 * Queue pipeline: one invocation processes exactly ONE (instrument) job so no
 * single request approaches any CPU/memory ceiling. Each stage is independent
 * and idempotent; failures flag the instrument and move on.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { evaluateSetup, type SetupEvaluation } from "./profile";
import { buildTradeProfileV2, type V2Evaluation } from "./v2/profile.v2";
import { buildTradeProfileV3, type V3Evaluation } from "./v3/profile.v3";
import {
  claimV2Structure,
  claimV3Structure,
  recordObservations,
  v1ObservationRow,
  v2ErrorObservationRow,
  v2ObservationRow,
  v3ErrorObservationRow,
  v3ObservationRow,
  type Disposition,
} from "@/lib/research/observations.server";
import {
  enrolV2Shadow,
  enrolV3Shadow,
  isV2EnrolmentEnabled,
  isV3EnrolmentEnabled,
} from "@/lib/research/enrol.server";

import { atr } from "./indicators";
import { presentSignalBreakdown } from "./copy";
import { ACTIVE_MODEL_VERSION, observationKey } from "@/lib/versioning";
import { isTransientMetaApiReadFailure } from "@/lib/metaapi/errors";
import { fetchCandles, MetaApiNotConfiguredError } from "./metaapi.server";
import {
  CANDLE_LIMITS,
  ENTRY_PRICE_DECIMALS,
  INSTRUMENTS,
  SIGNAL_MAX_AGE_HOURS,
  STRUCTURE_COOLDOWN_MINUTES,
  hasValidatedSpreadFloor,
  type Candle,
  type Timeframe,
} from "./types";
import { REGISTRY_SYMBOLS } from "@/lib/instruments/registry";
import { describeStage, mayPublish, mayScan, stageOf } from "@/lib/instruments/lifecycle";
import { readLifecycleView } from "@/lib/instruments/lifecycle.server";

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

/**
 * The instruments this cycle scans.
 *
 * While lifecycle enforcement is OFF this is exactly the frozen Wave 0 universe,
 * so Phase A cannot change a single scan cycle. Once enforcement is ON the
 * lifecycle table decides: any instrument at `data_validation` or beyond is
 * scanned (which is how a new pair starts collecting measurable outcomes), and a
 * `suspended` or `disabled` instrument is dropped even if it is Wave 0.
 */
export async function scanUniverse(db: SupabaseClient): Promise<string[]> {
  const view = await readLifecycleView(db);
  if (!view.enforced) return [...INSTRUMENTS];
  return REGISTRY_SYMBOLS.filter((symbol) => mayScan(stageOf(symbol, view.stages)));
}

/** Enqueue one job per monitored instrument for this scan cycle. */
export async function enqueueScanCycle(db: SupabaseClient) {
  const { expired, error: expireError } = await expireStaleSignals(db);
  const runId = crypto.randomUUID();
  const rows = (await scanUniverse(db)).map((instrument) => ({
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
    consecutive_failures?: number;
    failure_scope?: string | null;
    breaker_open_until?: string | null;
  },
) {
  const { error } = await db
    .from("instrument_health")
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "instrument" });
  if (error) console.error("[pipeline] instrument_health write failed:", describeError(error));
}

/**
 * Per-instrument failure isolation (Phase A / A6).
 *
 * Failures used to be counted only per pass, so one instrument that a broker
 * cannot serve looked the same as a dead provider. The counter and breaker now
 * live on the instrument's own health row: three consecutive failures open a
 * back-off window for THAT symbol, and every other symbol keeps scanning at full
 * cadence. `failure_scope` records whether the failure looked instrument-local or
 * provider-wide, so a widening outage stays visible instead of being attributed
 * to eight independent pairs.
 */
const BREAKER_TRIP_AFTER = 3;
const BREAKER_BACKOFF_MINUTES = [15, 30, 60] as const;

function backoffMs(failures: number): number {
  const index = Math.min(
    failures - BREAKER_TRIP_AFTER,
    BREAKER_BACKOFF_MINUTES.length - 1,
  );
  return BREAKER_BACKOFF_MINUTES[Math.max(0, index)]! * 60_000;
}

async function flagInstrument(
  db: SupabaseClient,
  instrument: string,
  message: string,
  scope: "instrument" | "provider" = "instrument",
) {
  const { data } = await db
    .from("instrument_health")
    .select("consecutive_failures")
    .eq("instrument", instrument)
    .maybeSingle();
  const failures = Number((data as { consecutive_failures?: number } | null)?.consecutive_failures ?? 0) + 1;
  const tripped = failures >= BREAKER_TRIP_AFTER;

  await writeHealth(db, {
    instrument,
    available: false,
    last_error: message.slice(0, 500),
    unavailable_until: new Date(Date.now() + 30 * 60_000).toISOString(),
    consecutive_failures: failures,
    failure_scope: scope,
    breaker_open_until: tripped ? new Date(Date.now() + backoffMs(failures)).toISOString() : null,
  });
}

async function clearInstrument(db: SupabaseClient, instrument: string) {
  await writeHealth(db, {
    instrument,
    available: true,
    last_error: null,
    unavailable_until: null,
    consecutive_failures: 0,
    failure_scope: null,
    breaker_open_until: null,
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

  // Read once per job: the gate below must use one consistent verdict, and a
  // degraded read falls back to the frozen Wave 0 stage rather than blocking.
  const lifecycle = await readLifecycleView(db);
  const lifecycleEnforced = lifecycle.enforced;
  const instrumentStage = stageOf(job.instrument, lifecycle.stages);


  /**
   * Research state for this observation. Populated only once candles have been
   * fetched successfully, so a job that never saw market data produces no
   * observation rows at all.
   */
  let observed = false;
  let v2: V2Evaluation | null = null;
  let v2Error: string | null = null;
  let v3: V3Evaluation | null = null;
  let v3Error: string | null = null;

  let v2Disposition: Disposition = "none";
  let v3Disposition: Disposition = "none";
  let v1Grade: string | null = null;
  let v1Direction: "long" | "short" | null = null;
  let v2LatencyMs: number | null = null;
  let v3LatencyMs: number | null = null;

  // Stage 3 research capture state. Populated only once V1 has actually
  // evaluated real candles; never used by any production decision below.
  let v1Evaluation: SetupEvaluation | null = null;
  let v1Session: string | null = null;
  let v1VolatilityIndex: number | null = null;
  let publishedSignalId: string | null = null;

  /**
   * Why a qualifying V1 structure was withheld, set at the exact branch that
   * withheld it (Phase A1, Finding 2).
   *
   * `skipped` used to collapse "lifecycle held it back", "no validated stop floor"
   * and "no structure at all" into one bucket, and `duplicate` was recorded as
   * `suppressed_cooldown` whether it was the cooldown window or the identical
   * active structure. Both mislabelled rows as strategy no-trades, which is the
   * one thing the rejection denominator must never contain.
   */
  let v1Suppression: { disposition: Disposition; reason: string } | null = null;

  /** V1 status -> (decision, disposition) for the research ledger. */
  const v1Cell = (
    status: JobResult["status"],
  ): { decision: "candidate" | "no_trade" | "error"; disposition: Disposition } => {
    if (status === "published") return { decision: "candidate", disposition: "published" };
    // A withheld structure IS a candidate: the model produced a setup, and an
    // operational rule stopped it. `decision` stays `candidate` so no downstream
    // count can read it as a rejection.
    if (v1Suppression)
      return { decision: "candidate", disposition: v1Suppression.disposition };
    if (status === "duplicate")
      return { decision: "candidate", disposition: "suppressed_duplicate" };
    if (status === "failed") return { decision: "error", disposition: "evaluation_error" };
    if (status === "stale") return { decision: "no_trade", disposition: "job_stale" };
    if (status === "skipped")
      return { decision: "no_trade", disposition: "operationally_skipped" };
    // The only remaining case is a genuine strategy verdict.
    return { decision: "no_trade", disposition: "none" };
  };


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

    /**
     * Research ledger. Isolated and bounded inside recordObservations: it can
     * neither throw into, nor slow down, the production job above.
     *
     * `mayCaptureResearch` is consulted here, not only at the strategy boundary:
     * an instrument at `data_validation` produces NO measurement rows at all,
     * because its inputs have not been proven trustworthy yet and a ledger seeded
     * with unvalidated inputs is worse than an empty one.
     */
    if (observed && (!lifecycleEnforced || mayCaptureResearch(instrumentStage))) {
      const key = observationKey(job.run_id, job.instrument);
      const cell = v1Cell(status);
      const rows = [
        v1ObservationRow({
          runId: job.run_id ?? null,
          observationKey: key,
          instrument: job.instrument,
          decision: cell.decision,
          grade: v1Grade,
          direction: v1Direction,
          disposition: cell.disposition,
          reason: detail ?? status,
          latencyMs: null,
          // Terminal stage, gates and features, so a no_trade observation is
          // reconstructable rather than a prose reason string.
          evaluation: v1Evaluation,
          suppressionReason: v1Suppression?.reason ?? null,
          lifecycleStage: instrumentStage,
          sessionVersion: SESSION_VERSION,
        }),
      ];

      if (v2) {
        rows.push(
          v2ObservationRow({
            runId: job.run_id ?? null,
            observationKey: key,
            instrument: job.instrument,
            evaluation: v2,
            disposition: v2Disposition,
            latencyMs: v2LatencyMs,
          }),
        );
      } else if (v2Error) {
        rows.push(
          v2ErrorObservationRow({
            runId: job.run_id ?? null,
            observationKey: key,
            instrument: job.instrument,
            reason: v2Error,
            latencyMs: v2LatencyMs,
          }),
        );
      }
      if (v3) {
        rows.push(
          v3ObservationRow({
            runId: job.run_id ?? null,
            observationKey: key,
            instrument: job.instrument,
            evaluation: v3,
            disposition: v3Disposition,
            latencyMs: v3LatencyMs,
          }),
        );
      } else if (v3Error) {
        rows.push(
          v3ErrorObservationRow({
            runId: job.run_id ?? null,
            observationKey: key,
            instrument: job.instrument,
            reason: v3Error,
            latencyMs: v3LatencyMs,
          }),
        );
      }

      await recordObservations(db, rows);

      // Stage 3: research candidate capture. Dark until the database switch is
      // enabled, isolated from the job result, and written after the production
      // work is already committed above.
      if (v1Evaluation) {
        try {
          const { captureCandidate, isCandidateCaptureEnabled } =
            await import("@/lib/research/candidates.server");
          if (await isCandidateCaptureEnabled(db)) {
            await captureCandidate(db, {
              runId: job.run_id ?? null,
              observationKey: key,
              instrument: job.instrument,
              detectedAt: stamp,
              session: v1Session,
              volatilityIndex: v1VolatilityIndex,
              evaluation: v1Evaluation,
              v1Decision: status,
              publishedSignalId,
            });
          }
        } catch {
          // Capture is never allowed to affect the scan result.
        }
      }
    }

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
    observed = true;

    // Session is resolved before grading so the entry math and the
    // market_context row can never disagree about which regime this setup is in.
    const now = new Date();
    const session = sessionOf(now);

    /**
     * Strategy-evaluation gate (Phase A1, Finding 1).
     *
     * Candles have now been fetched and the data-health row updated, which is the
     * ENTIRE purpose of `data_validation`. Running V1/V2/V3 here would grade data
     * whose mapping, specification and series integrity have not been proven, and
     * every resulting row would enter the research ledger as if it had been.
     *
     * So the strategy boundary — not the publication boundary — is where an
     * instrument below `shadow` stops. `observed` stays true, but the capture gate
     * in `finish` refuses to write measurement rows for this stage, so nothing is
     * recorded except the job outcome.
     */
    if (lifecycleEnforced && !mayEvaluateStrategy(instrumentStage)) {
      return await finish(
        "skipped",
        `${job.instrument} is at lifecycle stage "${instrumentStage}" (${describeStage(instrumentStage)}) — candles were fetched and validated, and no strategy was run`,
      );
    }



    /**
     * V2 research evaluation, hoisted ABOVE every V1 return so the research
     * cohort is one row per fetched observation rather than one row per V1
     * publication. Pure computation on the identical candle snapshot V1 grades;
     * it writes nothing and cannot affect the V1 path below.
     */
    try {
      const started = Date.now();
      v2 = buildTradeProfileV2({ instrument: job.instrument, candles });
      v2LatencyMs = Date.now() - started;
      if (v2.decision === "candidate" && v2.profile) {
        if (v2.observationOnly) {
          // Mean reversion is recorded but never forward-tested.
          v2Disposition = "observation_only";
        } else {
          const claimed = await claimV2Structure(
            db,
            v2.profile.structureKey,
            STRUCTURE_COOLDOWN_MINUTES,
          );
          v2Disposition = claimed ? "observation_only" : "suppressed_cooldown";
          if (claimed && (await isV2EnrolmentEnabled(db))) {
            const enrolled = await enrolV2Shadow(db, {
              profile: v2.profile,
              detectedAt: now.toISOString(),
              session,
              observationKey: observationKey(job.run_id, job.instrument),
            });
            if (enrolled) v2Disposition = "shadow_enrolled";
          }
        }
      }
    } catch (err) {
      // The crash itself is an observation: keep it instead of dropping V2.
      v2 = null;
      v2Error = err instanceof Error ? err.message : String(err);
      v2Disposition = "none";
    }

    /**
     * V3 geometry-correction research evaluation. Same contract as V2: same
     * candle snapshot, its own try/catch, its own structure claim slot, and its
     * own kill switch. It writes only research rows and cannot affect V1 or V2.
     */
    try {
      const started = Date.now();
      v3 = buildTradeProfileV3({ instrument: job.instrument, candles });
      v3LatencyMs = Date.now() - started;
      if (v3.decision === "candidate" && v3.profile) {
        if (v3.observationOnly) {
          // Mean reversion is recorded but never forward-tested.
          v3Disposition = "observation_only";
        } else {
          const claimed = await claimV3Structure(
            db,
            v3.profile.structureKey,
            STRUCTURE_COOLDOWN_MINUTES,
          );
          v3Disposition = claimed ? "observation_only" : "suppressed_cooldown";
          if (claimed && (await isV3EnrolmentEnabled(db))) {
            const enrolled = await enrolV3Shadow(db, {
              profile: v3.profile,
              detectedAt: now.toISOString(),
              session,
              observationKey: observationKey(job.run_id, job.instrument),
            });
            if (enrolled) v3Disposition = "shadow_enrolled";
          }
        }
      }
    } catch (err) {
      // The crash itself is an observation: keep it instead of dropping V3.
      v3 = null;
      v3Error = err instanceof Error ? err.message : String(err);
      v3Disposition = "none";
    }

    // Gate-labelled evaluation. `profile` is exactly what buildTradeProfile()
    // returned before: only a fully-passed evaluation can publish.
    const evaluation = evaluateSetup({ instrument: job.instrument, candles, session });
    v1Evaluation = evaluation;
    v1Session = session ?? null;

    const profile = evaluation.stage === "published" ? evaluation.proposedProfile : null;
    if (!profile) return await finish("no_trade", "No structure satisfied the ABC grading rules");
    v1Grade = profile.grade;
    v1Direction = profile.direction;

    /**
     * Lifecycle publication gate.
     *
     * An instrument below `signals_only` is measured, never shown: the research
     * observation for this job is already captured by `finish` (`observed` is
     * true by this point), so a suppressed pair still accumulates the outcomes
     * its promotion decision will be based on. The status is `skipped`, NOT
     * `no_trade` — a structure WAS found, and mislabelling it would corrupt both
     * the cron summary and the no-trade rate.
     */
    if (lifecycleEnforced && !mayPublish(instrumentStage)) {
      return await finish(
        "skipped",
        `${job.instrument} is at lifecycle stage "${instrumentStage}" (${describeStage(instrumentStage)}) — measured, not published`,
      );
    }

    /**
     * A published setup's stop must sit outside real execution cost. Wave 0 has
     * validated floors; a pair promoted without one would silently inherit the
     * shared default, which is a guess. Refuse rather than publish a stop we
     * cannot justify.
     */
    if (!hasValidatedSpreadFloor(job.instrument)) {
      return await finish(
        "skipped",
        `${job.instrument} has no validated stop floor yet — publication withheld`,
      );
    }

    // No global ceiling: every qualifying setup publishes. Each account applies
    // its own daily cap (scanner_settings.daily_setup_cap, 0 = unlimited) to
    // what it sees and is alerted about.

    // Structure cooldown: the same ABC leg may not republish inside this
    // window even after the previous instance expired or resolved. This is what
    // stops one lingering structure firing every 15 minutes.
    const cooldownFrom = new Date(Date.now() - STRUCTURE_COOLDOWN_MINUTES * 60_000).toISOString();
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
    const volatilityIndex = h1Atr > 0 && m15Atr > 0 ? Number((m15Atr / h1Atr).toFixed(4)) : null;
    v1VolatilityIndex = volatilityIndex;

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
        qualitative_breakdown: presentSignalBreakdown(profile.qualitativeBreakdown),
        detected_at: now.toISOString(),
        status: "active",
        resolved_outcome: "open",
        p_fill_prior: prior?.pFill ?? null,
        p_win_prior: prior?.pWin ?? null,
        // ev_prior keeps its original P(fill) x P(win|filled) meaning; p_joint_prior
        // is the same quantity under its truthful name. Never redefined.
        ev_prior: prior?.pJoint ?? null,
        p_joint_prior: prior?.pJoint ?? null,
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
    publishedSignalId = signalId;

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
        breakdown: presentSignalBreakdown(profile.qualitativeBreakdown),
        session: sessionOf(now),
      });
    } catch (alertErr) {
      console.error(`[pipeline] ${job.instrument} alert fan-out failed:`, describeError(alertErr));
    }

    // Automatic broker orders for armed accounts, gated by each owner's own
    // rules. Contained exactly like alerts: an enqueue failure never re-labels a
    // successful publish and never touches a statistic.
    try {
      const { enqueueDirectDeliveries } = await import("@/lib/delivery/direct-enqueue.server");
      const outcome = await enqueueDirectDeliveries(db, {
        id: signalId,
        instrument: profile.instrument,
        grade: profile.grade,
        session: sessionOf(now),
        detectedAt: now.toISOString(),
        // Only the optional per-user intelligence gate reads these; publication,
        // grading and every statistic remain untouched by them.
        direction: profile.direction,
        volatilityIndex,
      });
      if (outcome.reason && outcome.reason.includes("failed")) {
        console.error(`[pipeline] ${job.instrument} direct enqueue: ${outcome.reason}`);
      }
    } catch (execErr) {
      console.error(`[pipeline] ${job.instrument} direct enqueue failed:`, describeError(execErr));
    }

    return await finish("published", `${profile.grade}-grade ${profile.direction}`);
  } catch (err) {
    const message = describeError(err);
    console.error(`[pipeline] ${job.instrument} failed:`, message);

    // A unique-index collision is a benign duplicate, never a failure.
    if ((err as { code?: string } | null)?.code === "23505") {
      return await finish("duplicate", "An identical active setup is already published");
    }

    if (isTransientMetaApiReadFailure(err)) {
      // A gateway/transport outage says nothing about symbol availability.
      // The request boundary has already made its one safe GET retry; leave
      // health unchanged and let the next 15-minute cycle try again.
      return await finish("skipped", message);
    }
    if (err instanceof MetaApiNotConfiguredError) {
      // Missing configuration is persistent and should stay visible in health.
      await flagInstrument(db, job.instrument, message);
      return await finish("skipped", message);
    }
    await flagInstrument(db, job.instrument, message);
    return await finish("failed", message);
  }
}
