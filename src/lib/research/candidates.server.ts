/**
 * Stage 3 — research candidate capture (dark by default).
 *
 * The learning engine used to see only the setups V1 chose to publish, so it
 * could never answer "were the rejected ones worse?". This module records EVERY
 * evaluation the scanner performed — terminal stage, per-gate outcome, the
 * deterministic measurements behind it and, when it was actually derived, the
 * proposed geometry.
 *
 * Hard rules:
 *  - Capture is gated by `shadow_engine_state.candidate_capture_enabled`. Off by
 *    default: nothing is written until the switch is flipped in the database.
 *  - It NEVER throws into the scan job and never changes what publishes. A failed
 *    capture records durable health and returns false.
 *  - Geometry columns stay NULL when the value genuinely could not be computed.
 *    No placeholder entries, stops or targets are ever invented.
 *  - Nothing here writes to `scanned_signals`, alerts, or any trader-visible
 *    surface, and captured rows are readable only by service_role.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SetupEvaluation } from "@/lib/scanner/profile";
import { STRATEGY_V1_MANIFEST_HASH, STRATEGY_V1_VERSION } from "@/lib/scanner/strategy-manifest";
import { noteResearchFailure, RESEARCH_WRITE_DEADLINE_MS } from "./observations.server";
import { buildCounterfactualPlan, RESEARCH_PLAN_VERSION } from "./counterfactual-plan";

/** Reads the capture kill switch. Any failure is treated as "disabled". */
export async function isCandidateCaptureEnabled(db: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await db
      .from("shadow_engine_state")
      .select("candidate_capture_enabled")
      .eq("id", true)
      .maybeSingle();
    if (error) return false;
    return Boolean(
      (data as { candidate_capture_enabled?: boolean } | null)?.candidate_capture_enabled,
    );
  } catch {
    return false;
  }
}

export interface CaptureCandidateArgs {
  runId: string | null;
  observationKey: string | null;
  instrument: string;
  detectedAt: string;
  session: string | null;
  volatilityIndex: number | null;
  evaluation: SetupEvaluation;
  /** What V1 actually did with it: the published/no-trade/duplicate outcome. */
  v1Decision: string;
  /** Set only when V1 published this candidate as a live signal. */
  publishedSignalId: string | null;
}

/**
 * Write one candidate row. Returns true only when a row was inserted.
 * Never throws.
 */
export async function captureCandidate(
  db: SupabaseClient,
  args: CaptureCandidateArgs,
  deadlineMs = RESEARCH_WRITE_DEADLINE_MS,
): Promise<boolean> {
  const e = args.evaluation;
  const g = e.geometry;
  const p = e.proposedProfile;

  // A gate list is only complete when every gate reached a verdict; a partial
  // list must be visibly partial rather than silently read as "all passed".
  const gatesComplete = e.gates.length === 8;

  // Prompt 7G: a filter-rejected setup with fully derived geometry gets a
  // research-only ladder so the "fail" arm of filter lift can ever be populated.
  // It is stored under `plan_origin='counterfactual'` and can never be confused
  // with a production plan, which keeps its published values untouched.
  const counterfactual = p ? null : buildCounterfactualPlan(e);
  const planOrigin = p ? "production" : counterfactual ? "counterfactual" : null;

  try {
    const insert = db.from("research_candidates").insert({
      run_id: args.runId,
      observation_key: args.observationKey,
      instrument: args.instrument,
      direction: e.direction,
      strategy_version: STRATEGY_V1_VERSION,
      manifest_hash: STRATEGY_V1_MANIFEST_HASH,
      code_hash: STRATEGY_V1_MANIFEST_HASH,
      detected_at: args.detectedAt,
      trading_session: args.session,
      volatility_index: args.volatilityIndex,
      terminal_stage: e.stage,
      v1_decision: args.v1Decision,
      gates: e.gates,
      gates_complete: gatesComplete,
      features: e.features,
      // Geometry: only what was derived. Targets exist solely for a full plan.
      grade: p?.grade ?? counterfactual?.grade ?? null,
      plan_origin: planOrigin,
      counterfactual_stage: counterfactual ? e.stage : null,
      research_plan_version: counterfactual ? RESEARCH_PLAN_VERSION : null,
      counterfactual_class: e.counterfactual,
      structure_key: g.structureKey,
      entry_price: g.entryPrice,
      stop_loss: g.stopLoss,
      risk_price: g.riskPrice,
      atr: g.atr,
      tp1: p?.tp1 ?? counterfactual?.tp1 ?? null,
      tp2: p?.tp2 ?? counterfactual?.tp2 ?? null,
      tp3: p?.tp3 ?? counterfactual?.tp3 ?? null,
      tp1_r: p?.tp1R ?? counterfactual?.tp1R ?? null,
      tp2_r: p?.tp2R ?? counterfactual?.tp2R ?? null,
      tp3_r: p?.tp3R ?? counterfactual?.tp3R ?? null,
      max_r: p?.maxR ?? counterfactual?.maxR ?? null,
      confidence_score: p?.confidence.score ?? null,
      published_signal_id: args.publishedSignalId,
    });

    const { error } = (await Promise.race([
      insert,
      new Promise<{ error: { message: string } }>((resolve) =>
        setTimeout(
          () => resolve({ error: { message: "candidate capture deadline exceeded" } }),
          deadlineMs,
        ),
      ),
    ])) as { error: { message: string } | null };

    if (error) {
      // Identity collision = this run already captured this instrument/direction.
      // That is idempotency working, not a failure.
      if (/duplicate key|unique/i.test(error.message)) return false;
      await noteResearchFailure(db, `candidate capture failed: ${error.message}`);
      return false;
    }
    return true;
  } catch (err) {
    await noteResearchFailure(
      db,
      `candidate capture threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}
