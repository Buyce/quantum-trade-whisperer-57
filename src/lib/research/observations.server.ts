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
  | "published"
  | "shadow_enrolled"
  | "observation_only"
  | "suppressed_cooldown"
  | "none";

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

async function bounded<T>(work: Promise<T>, ms: number): Promise<T | "deadline"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<"deadline">((resolve) => {
        timer = setTimeout(() => resolve("deadline"), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Persist observation rows. Never throws — returns how many rows were written.
 */
export async function recordObservations(
  db: SupabaseClient,
  rows: ObservationRow[],
  deadlineMs = RESEARCH_WRITE_DEADLINE_MS,
): Promise<number> {
  if (!rows.length) return 0;
  try {
    const result = await bounded(
      db.from("model_observations").insert(rows).then((r) => r),
      deadlineMs,
    );
    if (result === "deadline") {
      failureCount += 1;
      return 0;
    }
    if (result.error) {
      failureCount += 1;
      return 0;
    }
    return rows.length;
  } catch {
    failureCount += 1;
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
      failureCount += 1;
      return false;
    }
    return result.data === true;
  } catch {
    failureCount += 1;
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
