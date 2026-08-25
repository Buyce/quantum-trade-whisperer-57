/**
 * V2 shadow enrolment.
 *
 * The research model forward-tests through the same replay engine as V1, but it
 * is enrolled on its own terms:
 *  - gated by the database kill switch `shadow_engine_state.v2_enabled`;
 *  - continuation family only (mean reversion stays observation-only);
 *  - only after `claim_v2_structure()` awarded this caller the structure.
 *
 * Nothing here writes to `scanned_signals`, alerts, push, email, webhooks or
 * any MCP live-signal surface: V2 rows exist solely as `model_version = 2`
 * shadow executions.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MODEL_V2_VERSION } from "@/lib/scanner/v2/manifest";
import type { V2Profile } from "@/lib/scanner/v2/profile.v2";
import { noteResearchFailure, RESEARCH_WRITE_DEADLINE_MS } from "./observations.server";

/** Reads the database kill switch. Any failure is treated as "disabled". */
export async function isV2EnrolmentEnabled(db: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await db
      .from("shadow_engine_state")
      .select("v2_enabled")
      .eq("id", true)
      .maybeSingle();
    if (error) return false;
    return Boolean((data as { v2_enabled?: boolean } | null)?.v2_enabled);
  } catch {
    return false;
  }
}

export interface V2EnrolmentArgs {
  profile: V2Profile;
  detectedAt: string;
  session: string | null;
  observationKey: string | null;
  cooldownMinutes: number;
}

interface AtomicModelEnrolmentResult {
  inserted?: boolean;
  claimed?: boolean;
  reason?: string | null;
  plan_id?: string | null;
}

async function atomicModelShadowEnrolment(
  db: SupabaseClient,
  args: {
    claimModelVersion: number;
    modelVersion: number;
    structureKey: string;
    cooldownMinutes: number;
    instrument: string;
    grade: string;
    direction: string;
    detectedAt: string;
    entryPrice: number;
    stopLoss: number;
    tp1: number;
    tp2: number;
    tp3: number;
    tp1R: number;
    tp2R: number;
    tp3R: number;
    maxR: number;
    atr: number;
    session: string | null;
    observationKey: string | null;
    strategyFamily: string;
    qualityGrade: string;
    entrySource?: string | null;
    stopAnchor?: string | null;
  },
  deadlineMs: number,
): Promise<AtomicModelEnrolmentResult | "deadline" | { error: string }> {
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      db
        .rpc("claim_and_enrol_model_shadow", {
          _claim_model_version: args.claimModelVersion,
          _structure_key: args.structureKey,
          _cooldown_minutes: args.cooldownMinutes,
          _instrument: args.instrument,
          _grade: args.grade,
          _direction: args.direction,
          _detected_at: args.detectedAt,
          _entry_price: args.entryPrice,
          _stop_loss: args.stopLoss,
          _tp1: args.tp1,
          _tp2: args.tp2,
          _tp3: args.tp3,
          _tp1_r: args.tp1R,
          _tp2_r: args.tp2R,
          _tp3_r: args.tp3R,
          _max_r: args.maxR,
          _risk_price: Math.abs(args.entryPrice - args.stopLoss),
          _atr: args.atr,
          _trading_session: args.session,
          _model_version: args.modelVersion,
          _observation_key: args.observationKey,
          _strategy_family: args.strategyFamily,
          _quality_grade: args.qualityGrade,
          _entry_source: args.entrySource ?? null,
          _stop_anchor: args.stopAnchor ?? null,
        })
        .then((r) => r),
      new Promise<"deadline">((resolve) => {
        timer = setTimeout(() => resolve("deadline"), deadlineMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (result === "deadline") return result;
    if (result.error) return { error: result.error.message };
    return (result.data ?? {}) as AtomicModelEnrolmentResult;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Insert one research shadow row. Returns true only when a row was written.
 * Never throws: a failed research write records durable health and leaves the
 * V1 job result untouched.
 */
export async function enrolV2Shadow(
  db: SupabaseClient,
  args: V2EnrolmentArgs,
  deadlineMs = RESEARCH_WRITE_DEADLINE_MS,
): Promise<boolean> {
  const p = args.profile;
  const result = await atomicModelShadowEnrolment(
    db,
    {
      claimModelVersion: MODEL_V2_VERSION,
      modelVersion: MODEL_V2_VERSION,
      structureKey: p.structureKey,
      cooldownMinutes: args.cooldownMinutes,
      instrument: p.instrument,
      grade: p.grade,
      direction: p.direction,
      detectedAt: args.detectedAt,
      entryPrice: p.entryPrice,
      stopLoss: p.stopLoss,
      tp1: p.tp1,
      tp2: p.tp2,
      tp3: p.tp3,
      tp1R: p.tp1R,
      tp2R: p.tp2R,
      tp3R: p.tp3R,
      maxR: p.maxR,
      atr: p.atr,
      session: args.session,
      observationKey: args.observationKey,
      strategyFamily: p.family,
      qualityGrade: p.grade,
    },
    deadlineMs,
  );
  if (result === "deadline") {
    await noteResearchFailure(db, "v2 shadow enrolment exceeded deadline", deadlineMs);
    return false;
  }
  if ("error" in result) {
    await noteResearchFailure(db, `v2 shadow enrolment failed: ${result.error}`, deadlineMs);
    return false;
  }
  return result.inserted === true;
}

/**
 * V3 shadow enrolment.
 *
 * The V3 research model forward-tests through the same replay engine as V1/V2,
 * but it is enrolled on its own terms:
 *  - gated by the database kill switch `shadow_engine_state.v3_enabled`;
 *  - continuation family only (mean reversion stays observation-only);
 *  - only after `claim_v2_structure()` awarded this caller the structure for
 *    (model_version = 3, structure_key).
 *
 * Nothing here writes to `scanned_signals`, alerts, push, email, webhooks or
 * any MCP live-signal surface: V3 rows exist solely as `model_version = 3`
 * shadow executions.
 */
import { MODEL_V3_VERSION } from "@/lib/scanner/v3/manifest";
import type { V3Profile } from "@/lib/scanner/v3/profile.v3";

/** Reads the database kill switch. Any failure is treated as "disabled". */
export async function isV3EnrolmentEnabled(db: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await db
      .from("shadow_engine_state")
      .select("v3_enabled")
      .eq("id", true)
      .maybeSingle();
    if (error) return false;
    return Boolean((data as { v3_enabled?: boolean } | null)?.v3_enabled);
  } catch {
    return false;
  }
}

export interface V3EnrolmentArgs {
  profile: V3Profile;
  detectedAt: string;
  session: string | null;
  observationKey: string | null;
  cooldownMinutes: number;
}

/**
 * Insert one V3 research shadow row. Returns true only when a row was written.
 * Never throws: a failed research write records durable health and leaves the
 * V1 job result untouched. Provenance (entry_source / stop_anchor) is stamped
 * so a shadow outcome can be traced back to the geometry that produced it.
 */
export async function enrolV3Shadow(
  db: SupabaseClient,
  args: V3EnrolmentArgs,
  deadlineMs = RESEARCH_WRITE_DEADLINE_MS,
): Promise<boolean> {
  const p = args.profile;
  const result = await atomicModelShadowEnrolment(
    db,
    {
      claimModelVersion: MODEL_V3_VERSION,
      modelVersion: MODEL_V3_VERSION,
      structureKey: p.structureKey,
      cooldownMinutes: args.cooldownMinutes,
      instrument: p.instrument,
      grade: p.grade,
      direction: p.direction,
      detectedAt: args.detectedAt,
      entryPrice: p.entryPrice,
      stopLoss: p.stopLoss,
      tp1: p.tp1,
      tp2: p.tp2,
      tp3: p.tp3,
      tp1R: p.tp1R,
      tp2R: p.tp2R,
      tp3R: p.tp3R,
      maxR: p.maxR,
      atr: p.atr,
      session: args.session,
      observationKey: args.observationKey,
      strategyFamily: p.family,
      qualityGrade: p.grade,
      entrySource: p.entrySource,
      stopAnchor: p.stopAnchor,
    },
    deadlineMs,
  );
  if (result === "deadline") {
    await noteResearchFailure(db, "v3 shadow enrolment exceeded deadline", deadlineMs);
    return false;
  }
  if ("error" in result) {
    await noteResearchFailure(db, `v3 shadow enrolment failed: ${result.error}`, deadlineMs);
    return false;
  }
  return result.inserted === true;
}
