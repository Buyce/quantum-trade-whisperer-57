/**
 * Research telemetry writer for the V1/V2 grading comparison.
 *
 * Contract, enforced here so the caller cannot get it wrong:
 *  - V2 evaluation NEVER changes V1 behaviour. Every call is wrapped in
 *    try/catch and bounded by a hard deadline, so a slow or failing research
 *    write can neither delay nor fail a production scan job.
 *  - One row per model per successfully fetched scan observation, whether or not
 *    anything was published. That is what makes the two models comparable: V2 is
 *    evaluated on observations, not on V1's publications.
 *  - V2 rows are `model_version = 2` and are never published to users.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MODEL_V2_CODE_HASH, MODEL_V2_VERSION } from "@/lib/scanner/v2/manifest";
import type { V2Evaluation } from "@/lib/scanner/v2/profile.v2";

/** Hard ceiling for all research writes of one job, in milliseconds. */
export const RESEARCH_WRITE_DEADLINE_MS = 500;

export type Disposition =
  "published" | "shadow_enrolled" | "observation_only" | "suppressed_cooldown" | "none";

export interface ObservationRow {
  run_id: string | null;
  observation_key: string | null;
  model_version: number;
  instrument: string;
  decision: "candidate" | "no_trade" | "error";
  family: "continuation" | "mean_reversion" | null;
  grade: string | null;
  direction: "long" | "short" | null;
  disposition: Disposition;
  reason: string | null;
  code_hash: string | null;
  latency_ms: number | null;
  signal_id: string | null;
  profile: unknown;
}

/** Counts research failures so the admin panel can see telemetry health. */
let failureCount = 0;
export function researchFailureCount(): number {
  return failureCount;
}

async function bounded<T>(work: PromiseLike<T>, ms: number): Promise<T | "deadline"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(work),
      new Promise<"deadline">((resolve) => {
        timer = setTimeout(() => resolve("deadline"), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Durable research health. The in-process counter dies with the worker, so the
 * failure is also recorded on `shadow_engine_state` where an operator can see
 * it. Bounded and swallowing: research bookkeeping never affects a scan job.
 */
export async function noteResearchFailure(
  db: SupabaseClient,
  message: string,
  deadlineMs = RESEARCH_WRITE_DEADLINE_MS,
): Promise<void> {
  failureCount += 1;
  try {
    const current = await bounded(
      db
        .from("shadow_engine_state")
        .select("research_errors")
        .eq("id", true)
        .maybeSingle()
        .then((r) => r),
      deadlineMs,
    );
    const errors =
      current === "deadline"
        ? 1
        : Number((current.data as { research_errors?: number } | null)?.research_errors ?? 0) + 1;
    await bounded(
      db
        .from("shadow_engine_state")
        .update({
          research_errors: errors,
          research_last_error: message.slice(0, 500),
          research_last_error_at: new Date().toISOString(),
        })
        .eq("id", true)
        .then((r) => r),
      deadlineMs,
    );
  } catch {
    // Intentionally silent: telemetry about telemetry must not escalate.
  }
}

/**
 * Persist observation rows. Never throws — returns how many rows were written.
 *
 * Upsert on the (run_id, instrument, model_version) identity so a retried scan
 * job updates its own observation pair instead of double-counting the
 * experiment. Rows without a run_id fall back to plain inserts.
 */
export async function recordObservations(
  db: SupabaseClient,
  rows: ObservationRow[],
  deadlineMs = RESEARCH_WRITE_DEADLINE_MS,
): Promise<number> {
  if (!rows.length) return 0;
  try {
    const identified = rows.every((r) => r.run_id);
    const query = identified
      ? db
          .from("model_observations")
          .upsert(rows, { onConflict: "run_id,instrument,model_version" })
      : db.from("model_observations").insert(rows);
    const result = await bounded(
      query.then((r) => r),
      deadlineMs,
    );
    if (result === "deadline") {
      await noteResearchFailure(db, "observation write exceeded deadline", deadlineMs);
      return 0;
    }
    if (result.error) {
      await noteResearchFailure(
        db,
        `observation write failed: ${result.error.message}`,
        deadlineMs,
      );
      return 0;
    }
    return rows.length;
  } catch (err) {
    await noteResearchFailure(
      db,
      `observation write threw: ${err instanceof Error ? err.message : String(err)}`,
      deadlineMs,
    );
    return 0;
  }
}

/**
 * Race-safe research cooldown: true only for the caller that claims the
 * structure. Failure is treated as "not claimed" so a broken claim table can
 * never cause duplicate research rows to be treated as fresh observations.
 */
export async function claimV2Structure(
  db: SupabaseClient,
  structureKey: string,
  cooldownMinutes: number,
  deadlineMs = RESEARCH_WRITE_DEADLINE_MS,
): Promise<boolean> {
  try {
    const result = await bounded(
      db
        .rpc("claim_v2_structure", {
          _model_version: MODEL_V2_VERSION,
          _structure_key: structureKey,
          _cooldown_minutes: cooldownMinutes,
        })
        .then((r) => r),
      deadlineMs,
    );
    if (result === "deadline" || result.error) {
      await noteResearchFailure(
        db,
        `claim_v2_structure failed: ${result === "deadline" ? "deadline" : result.error.message}`,
        deadlineMs,
      );
      return false;
    }
    return result.data === true;
  } catch (err) {
    await noteResearchFailure(
      db,
      `claim_v2_structure threw: ${err instanceof Error ? err.message : String(err)}`,
      deadlineMs,
    );
    return false;
  }
}

/** Maps a V2 evaluation plus its disposition onto an observation row. */
export function v2ObservationRow(args: {
  runId: string | null;
  observationKey: string | null;
  instrument: string;
  evaluation: V2Evaluation;
  disposition: Disposition;
  latencyMs: number | null;
}): ObservationRow {
  const p = args.evaluation.profile;
  return {
    run_id: args.runId,
    observation_key: args.observationKey,
    model_version: MODEL_V2_VERSION,
    instrument: args.instrument,
    decision: args.evaluation.decision,
    family: p?.family ?? null,
    grade: p?.grade ?? null,
    direction: p?.direction ?? null,
    disposition: args.disposition,
    reason: args.evaluation.reason,
    code_hash: MODEL_V2_CODE_HASH,
    latency_ms: args.latencyMs,
    signal_id: null,
    profile: p
      ? {
          entryPrice: p.entryPrice,
          stopLoss: p.stopLoss,
          tp1: p.tp1,
          tp2: p.tp2,
          tp3: p.tp3,
          tp1R: p.tp1R,
          tp2R: p.tp2R,
          tp3R: p.tp3R,
          maxR: p.maxR,
          rrRatio: p.rrRatio,
          retracement: p.retracement,
          patternSymmetry: p.patternSymmetry,
          headroomAtr: p.headroomAtr,
          barrierSource: p.barrierSource,
          structureKey: p.structureKey,
          pillarsPassed: p.pillarsPassed,
          pillars: {
            trend: p.pTrend,
            orderBlock: p.pOrderBlock,
            momentum: p.pMomentum,
            volatilityExpansion: p.pVolatilityExpansion,
          },
          reasons: p.reasons,
        }
      : null,
  };
}

/** Maps the V1 outcome of the same observation onto a row. */
export function v1ObservationRow(args: {
  runId: string | null;
  observationKey: string | null;
  instrument: string;
  decision: "candidate" | "no_trade" | "error";
  grade: string | null;
  direction: "long" | "short" | null;
  disposition: Disposition;
  reason: string;
  latencyMs: number | null;
  signalId?: string | null;
}): ObservationRow {
  return {
    run_id: args.runId,
    observation_key: args.observationKey,
    model_version: 1,
    instrument: args.instrument,
    decision: args.decision,
    family: null,
    grade: args.grade,
    direction: args.direction,
    disposition: args.disposition,
    reason: args.reason,
    code_hash: null,
    latency_ms: args.latencyMs,
    signal_id: args.signalId ?? null,
    profile: null,
  };
}

/**
 * A V2 evaluator crash is itself an observation: losing it would silently
 * shrink the experiment's denominator. Persisted as decision='error' with a
 * truncated reason and no profile.
 */
export function v2ErrorObservationRow(args: {
  runId: string | null;
  observationKey: string | null;
  instrument: string;
  reason: string;
  latencyMs: number | null;
}): ObservationRow {
  return {
    run_id: args.runId,
    observation_key: args.observationKey,
    model_version: MODEL_V2_VERSION,
    instrument: args.instrument,
    decision: "error",
    family: null,
    grade: null,
    direction: null,
    disposition: "none",
    reason: args.reason.slice(0, 500),
    code_hash: MODEL_V2_CODE_HASH,
    latency_ms: args.latencyMs,
    signal_id: null,
    profile: null,
  };
}
