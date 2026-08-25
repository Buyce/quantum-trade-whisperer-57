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
import { assertCapability } from "@/lib/instruments/lifecycle.server";
import { provenanceColumns, type DetectionProvenance } from "@/lib/instruments/provenance";
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
  /**
   * Detection provenance (R7/R8): candle policy, as-of bar time and the provider
   * symbol the numbers came from. Omitted stores NULLs, which marks the row as
   * pre-provenance rather than pretending a policy was recorded.
   */
  provenance?: DetectionProvenance | null;
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

  // Prompt 7G (red-team corrected): EVERY executable evaluation — published or
  // filter-rejected — carries the same frozen research ladder, stored in its own
  // `cf_*` columns. Production columns keep exactly what V1 derived, so a
  // research plan can never be read as a traded plan, and the pass/fail arms of
  // filter lift are replayed under one identical, filter-independent policy.
  const ladder = buildCounterfactualPlan(e);
  const planOrigin = p ? "production" : ladder ? "counterfactual" : null;

  try {
    const gate = await Promise.race([
      assertCapability(db, args.instrument, "capture_research"),
      new Promise<"deadline">((resolve) => setTimeout(() => resolve("deadline"), deadlineMs)),
    ]);
    if (gate === "deadline") {
      await noteResearchFailure(db, "candidate capture lifecycle gate exceeded deadline");
      return false;
    }
    if (!gate.allowed) return false;

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
      grade: p?.grade ?? ladder?.grade ?? null,
      plan_origin: planOrigin,
      counterfactual_stage: p ? null : ladder ? e.stage : null,
      research_plan_version: ladder ? RESEARCH_PLAN_VERSION : null,
      counterfactual_class: e.counterfactual,
      structure_key: g.structureKey,
      entry_price: g.entryPrice,
      stop_loss: g.stopLoss,
      risk_price: g.riskPrice,
      atr: g.atr,
      // Production plan columns: NULL unless V1 actually published a profile.
      tp1: p?.tp1 ?? null,
      tp2: p?.tp2 ?? null,
      tp3: p?.tp3 ?? null,
      tp1_r: p?.tp1R ?? null,
      tp2_r: p?.tp2R ?? null,
      tp3_r: p?.tp3R ?? null,
      max_r: p?.maxR ?? null,
      confidence_score: p?.confidence.score ?? null,
      // The common research ladder, kept strictly separate from the above.
      cf_tp1: ladder?.tp1 ?? null,
      cf_tp2: ladder?.tp2 ?? null,
      cf_tp3: ladder?.tp3 ?? null,
      cf_tp1_r: ladder?.tp1R ?? null,
      cf_tp2_r: ladder?.tp2R ?? null,
      cf_tp3_r: ladder?.tp3R ?? null,
      cf_max_r: ladder?.maxR ?? null,
      cf_grade: ladder?.grade ?? null,
      cf_plan_version: ladder?.researchPlanVersion ?? null,
      published_signal_id: args.publishedSignalId,
      // Detection provenance (R7/R8). NULLs when it was not recorded.
      ...provenanceColumns(args.provenance),
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
