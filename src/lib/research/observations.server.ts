/**
 * Research telemetry writer for the V1/V2/V3 grading comparison.
 *
 * Contract, enforced here so the caller cannot get it wrong:
 *  - Research evaluation NEVER changes V1 behaviour. Every call is wrapped in
 *    try/catch and bounded by a hard deadline, so a slow or failing research
 *    write can neither delay nor fail a production scan job.
 *  - One row per model per successfully fetched scan observation, whether or not
 *    anything was published. That is what makes the models comparable: V2/V3 are
 *    evaluated on observations, not on V1's publications.
 *  - V2/V3 rows are stamped `model_version = 2 / 3` and are never published to
 *    users.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SetupEvaluation } from "@/lib/scanner/profile";
import { MODEL_V2_CODE_HASH, MODEL_V2_VERSION } from "@/lib/scanner/v2/manifest";
import type { V2Evaluation } from "@/lib/scanner/v2/profile.v2";
import { MODEL_V3_CODE_HASH, MODEL_V3_VERSION } from "@/lib/scanner/v3/manifest";
import type { V3Evaluation } from "@/lib/scanner/v3/profile.v3";

/** Hard ceiling for all research writes of one job, in milliseconds. */
export const RESEARCH_WRITE_DEADLINE_MS = 500;

/**
 * Disposition — WHAT HAPPENED to an evaluated observation (Phase A1, Finding 2).
 *
 * These values must stay MUTUALLY EXCLUSIVE and EXHAUSTIVE, because the statistics
 * layer derives the strategy no-trade rate from `decision`, and every non-`none`
 * disposition is a reason a row must be excluded from a rejection denominator.
 *
 *   published            — a qualifying setup reached `scanned_signals`.
 *   shadow_enrolled      — a research plan is being forward-tracked.
 *   observation_only     — evaluated and recorded, never forward-tracked.
 *   suppressed_cooldown  — qualifying, withheld by the structure cooldown.
 *   suppressed_duplicate — qualifying, an identical active setup already exists.
 *   suppressed_lifecycle — qualifying, withheld because the instrument's lifecycle
 *                          stage does not permit publication. NOT a rejection.
 *   evaluation_error     — the model crashed; no verdict exists.
 *   data_unavailable     — the provider did not return usable market data.
 *   job_stale            — the scan cycle was superseded before grading.
 *   operationally_skipped— withheld by an operational rule that is not a strategy
 *                          judgement (for example a missing validated stop floor).
 *   none                 — a genuine strategy verdict with nothing suppressing it.
 */
export type Disposition =
  | "published"
  | "shadow_enrolled"
  | "observation_only"
  | "suppressed_cooldown"
  | "suppressed_duplicate"
  | "suppressed_lifecycle"
  | "evaluation_error"
  | "data_unavailable"
  | "job_stale"
  | "operationally_skipped"
  | "none";

/**
 * Dispositions that mean "a qualifying structure existed but was withheld".
 *
 * A row carrying one of these may NEVER be counted as a strategy rejection or a
 * no-trade, whatever its `decision` column says.
 */
export const SUPPRESSED_DISPOSITIONS: readonly Disposition[] = [
  "suppressed_cooldown",
  "suppressed_duplicate",
  "suppressed_lifecycle",
];

/** Dispositions that mean "no verdict was produced at all". */
export const NON_VERDICT_DISPOSITIONS: readonly Disposition[] = [
  "evaluation_error",
  "data_unavailable",
  "job_stale",
  "operationally_skipped",
];

/** True when the row represents a genuine strategy no-trade judgement. */
export function isStrategyNoTrade(row: {
  decision: string;
  disposition: Disposition;
}): boolean {
  return (
    row.decision === "no_trade" &&
    !SUPPRESSED_DISPOSITIONS.includes(row.disposition) &&
    !NON_VERDICT_DISPOSITIONS.includes(row.disposition)
  );
}

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
  /** Why the row was withheld, when it was. Null for `none`/`published`. */
  suppression_reason?: string | null;
  /** Lifecycle stage the instrument was at when the observation was made. */
  lifecycle_stage_at_detection?: string | null;
  /** Session algorithm version that produced `trading_session` semantics. */
  session_version?: number | null;
  canonical_instrument?: string | null;
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
 * Race-safe research cooldown keyed per (model_version, structure_key). True
 * only for the caller that claims the structure. Failure is treated as "not
 * claimed" so a broken claim table can never cause duplicate research rows to
 * be treated as fresh observations.
 */
export async function claimStructure(
  db: SupabaseClient,
  args: { modelVersion: number; structureKey: string; cooldownMinutes: number },
  deadlineMs = RESEARCH_WRITE_DEADLINE_MS,
): Promise<boolean> {
  try {
    const result = await bounded(
      db
        .rpc("claim_v2_structure", {
          _model_version: args.modelVersion,
          _structure_key: args.structureKey,
          _cooldown_minutes: args.cooldownMinutes,
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

/** V2 claim — preserved thin wrapper so existing call sites are unchanged. */
export async function claimV2Structure(
  db: SupabaseClient,
  structureKey: string,
  cooldownMinutes: number,
  deadlineMs = RESEARCH_WRITE_DEADLINE_MS,
): Promise<boolean> {
  return claimStructure(
    db,
    { modelVersion: MODEL_V2_VERSION, structureKey, cooldownMinutes },
    deadlineMs,
  );
}

/** V3 claim — its own cooldown slot per (model_version, structure_key). */
export async function claimV3Structure(
  db: SupabaseClient,
  structureKey: string,
  cooldownMinutes: number,
  deadlineMs = RESEARCH_WRITE_DEADLINE_MS,
): Promise<boolean> {
  return claimStructure(
    db,
    { modelVersion: MODEL_V3_VERSION, structureKey, cooldownMinutes },
    deadlineMs,
  );
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

/**
 * Maps the V1 outcome of the same observation onto a row.
 *
 * When the gate-labelled evaluation is available it is persisted verbatim:
 * terminal stage, gates in evaluation order, deterministic features and the
 * geometry that was actually derived. Nothing is invented — a stage that never
 * produced geometry stores nulls, and a rejected setup stores no plan. Without
 * this, a no_trade row records only prose and the reason a filter fired can
 * never be recovered from the ledger.
 */
/**
 * The truthful research reason for a V1 evaluation: the exact terminal stage
 * enum value, plus the detail of the gate that terminated it when there is one.
 * No new stage names are invented and no prose is substituted.
 */
export function researchReason(ev: SetupEvaluation): string {
  const failing = [...ev.gates].reverse().find((g) => g.outcome === "fail");
  const detail = failing?.detail?.trim();
  const base = detail ? `${ev.stage}: ${detail}` : ev.stage;
  return base.slice(0, 500);
}

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
  evaluation?: SetupEvaluation | null;
}): ObservationRow {
  const ev = args.evaluation ?? null;
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
    // Research reason is the TERMINAL EVALUATION STAGE, not the trader-facing
    // prose. The job result keeps its own wording; the ledger records why.
    reason: ev ? researchReason(ev) : args.reason,
    code_hash: null,
    latency_ms: args.latencyMs,
    signal_id: args.signalId ?? null,
    profile: ev
      ? {
          stage: ev.stage,
          gates: ev.gates,
          features: ev.features,
          geometry: ev.geometry,
          hasProposedProfile: ev.proposedProfile !== null,
        }
      : null,
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

/** Maps a V3 evaluation plus its disposition onto an observation row. */
export function v3ObservationRow(args: {
  runId: string | null;
  observationKey: string | null;
  instrument: string;
  evaluation: V3Evaluation;
  disposition: Disposition;
  latencyMs: number | null;
}): ObservationRow {
  const p = args.evaluation.profile;
  return {
    run_id: args.runId,
    observation_key: args.observationKey,
    model_version: MODEL_V3_VERSION,
    instrument: args.instrument,
    decision: args.evaluation.decision,
    family: p?.family ?? null,
    grade: p?.grade ?? null,
    direction: p?.direction ?? null,
    disposition: args.disposition,
    reason: args.evaluation.reason,
    code_hash: MODEL_V3_CODE_HASH,
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
          maxAcceptableEntry: p.maxAcceptableEntry,
          limitOnly: p.limitOnly,
          slippageMinRatio: p.slippageMinRatio,
          retracement: p.retracement,
          patternSymmetry: p.patternSymmetry,
          headroomAtr: p.headroomAtr,
          barrierSource: p.barrierSource,
          structureKey: p.structureKey,
          entrySource: p.entrySource,
          stopAnchor: p.stopAnchor,
          stopAnchorPrice: p.stopAnchorPrice,
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

/**
 * A V3 evaluator crash is itself an observation: losing it would silently shrink
 * the experiment's denominator. Persisted as decision='error' with a truncated
 * reason and no profile.
 */
export function v3ErrorObservationRow(args: {
  runId: string | null;
  observationKey: string | null;
  instrument: string;
  reason: string;
  latencyMs: number | null;
}): ObservationRow {
  return {
    run_id: args.runId,
    observation_key: args.observationKey,
    model_version: MODEL_V3_VERSION,
    instrument: args.instrument,
    decision: "error",
    family: null,
    grade: null,
    direction: null,
    disposition: "none",
    reason: args.reason.slice(0, 500),
    code_hash: MODEL_V3_CODE_HASH,
    latency_ms: args.latencyMs,
    signal_id: null,
    profile: null,
  };
}
