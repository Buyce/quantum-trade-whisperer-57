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
  try {
    const insert = db.from("shadow_executions").insert({
      // Research rows are never backed by a published signal.
      signal_id: null,
      instrument: p.instrument,
      grade: p.grade,
      direction: p.direction,
      detected_at: args.detectedAt,
      entry_price: p.entryPrice,
      stop_loss: p.stopLoss,
      tp1: p.tp1,
      tp2: p.tp2,
      tp3: p.tp3,
      tp1_r: p.tp1R,
      tp2_r: p.tp2R,
      tp3_r: p.tp3R,
      max_r: p.maxR,
      risk_price: Math.abs(p.entryPrice - p.stopLoss),
      atr: p.atr,
      trading_session: args.session,
      status: "pending",
      replay_cursor: args.detectedAt,
      model_version: MODEL_V2_VERSION,
      observation_key: args.observationKey,
      strategy_family: p.family,
      quality_grade: p.grade,
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      insert.then((r) => r),
      new Promise<"deadline">((resolve) => {
        timer = setTimeout(() => resolve("deadline"), deadlineMs);
      }),
    ]);
    if (timer) clearTimeout(timer);

    if (result === "deadline") {
      await noteResearchFailure(db, "v2 shadow enrolment exceeded deadline", deadlineMs);
      return false;
    }
    if (result.error) {
      await noteResearchFailure(
        db,
        `v2 shadow enrolment failed: ${result.error.message}`,
        deadlineMs,
      );
      return false;
    }
    return true;
  } catch (err) {
    await noteResearchFailure(
      db,
      `v2 shadow enrolment threw: ${err instanceof Error ? err.message : String(err)}`,
      deadlineMs,
    );
    return false;
  }
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
  try {
    const insert = db.from("shadow_executions").insert({
      // Research rows are never backed by a published signal.
      signal_id: null,
      instrument: p.instrument,
      grade: p.grade,
      direction: p.direction,
      detected_at: args.detectedAt,
      entry_price: p.entryPrice,
      stop_loss: p.stopLoss,
      tp1: p.tp1,
      tp2: p.tp2,
      tp3: p.tp3,
      tp1_r: p.tp1R,
      tp2_r: p.tp2R,
      tp3_r: p.tp3R,
      max_r: p.maxR,
      risk_price: Math.abs(p.entryPrice - p.stopLoss),
      atr: p.atr,
      trading_session: args.session,
      status: "pending",
      replay_cursor: args.detectedAt,
      model_version: MODEL_V3_VERSION,
      observation_key: args.observationKey,
      strategy_family: p.family,
      quality_grade: p.grade,
      entry_source: p.entrySource,
      stop_anchor: p.stopAnchor,
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      insert.then((r) => r),
      new Promise<"deadline">((resolve) => {
        timer = setTimeout(() => resolve("deadline"), deadlineMs);
      }),
    ]);
    if (timer) clearTimeout(timer);

    if (result === "deadline") {
      await noteResearchFailure(db, "v3 shadow enrolment exceeded deadline", deadlineMs);
      return false;
    }
    if (result.error) {
      await noteResearchFailure(
        db,
        `v3 shadow enrolment failed: ${result.error.message}`,
        deadlineMs,
      );
      return false;
    }
    return true;
  } catch (err) {
    await noteResearchFailure(
      db,
      `v3 shadow enrolment threw: ${err instanceof Error ? err.message : String(err)}`,
      deadlineMs,
    );
    return false;
  }
}
