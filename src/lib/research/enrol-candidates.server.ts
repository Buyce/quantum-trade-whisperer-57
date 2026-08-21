/**
 * Stage 4 — research-candidate enrolment (dark by default).
 *
 * Stage 3 records every evaluation the scanner performed. This module takes the
 * subset that carries a COMPLETE, pre-specified executable profile and enrols it
 * as a forward-tested shadow execution in the `research_candidate` cohort, so a
 * filter's lift can eventually be measured against setups V1 rejected.
 *
 * Hard rules, enforced here so no caller can get them wrong:
 *  - Gated by `shadow_engine_state.candidate_enrolment_enabled`. It is FALSE and
 *    stays false: with the switch off this module performs one cheap flag read
 *    and returns zeroes.
 *  - No invented geometry. A candidate missing any part of the plan (entry,
 *    stop, positive risk, TP1..TP3, their R values, max R, grade, direction,
 *    ATR) or carrying a `not_evaluable` gate can NEVER become a trade.
 *  - Idempotent: a candidate-specific claim namespace plus the
 *    (plan_id, replay_version, execution_policy) identity, and
 *    `enrolled_plan_id` / `enrolled_at` are written only AFTER the execution row
 *    exists, conditionally on it still being NULL.
 *  - Replay-V1 semantics with an explicit `legacy_best_target_touched` policy,
 *    `cohort='research_candidate'`, `research_candidate_id` populated, and the
 *    candidate's own model/strategy provenance preserved.
 *  - It never throws. A failure records durable research health and cannot
 *    affect production scanner or resolver state.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { REPLAY_V1_VERSION } from "@/lib/execution/replay-registry";
import { noteResearchFailure, RESEARCH_WRITE_DEADLINE_MS } from "./observations.server";

/** The only execution policy a research candidate may ever be replayed under. */
export const CANDIDATE_EXECUTION_POLICY = "legacy_best_target_touched";
/** The only cohort a research-candidate execution may carry. */
export const CANDIDATE_COHORT = "research_candidate";
/**
 * Candidate claims live in their OWN model_version namespace. V2 uses 2 and V3
 * uses 3; 101 can never collide with a research model's claim slot, so a
 * candidate claim cannot consume a V2/V3 claim or vice versa.
 */
export const CANDIDATE_CLAIM_NAMESPACE = 101;
/** Cooldown for the candidate claim slot, in minutes. */
export const CANDIDATE_CLAIM_COOLDOWN_MINUTES = 120;

/** Reads the enrolment kill switch. Any failure is treated as "disabled". */
export async function isCandidateEnrolmentEnabled(db: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await db
      .from("shadow_engine_state")
      .select("candidate_enrolment_enabled")
      .eq("id", true)
      .maybeSingle();
    if (error) return false;
    return Boolean(
      (data as { candidate_enrolment_enabled?: boolean } | null)?.candidate_enrolment_enabled,
    );
  } catch {
    return false;
  }
}

/** Reads the per-run enrolment budget. Any failure is treated as zero. */
export async function candidateEnrolmentBudget(db: SupabaseClient): Promise<number> {
  try {
    const { data, error } = await db
      .from("shadow_engine_state")
      .select("candidate_rows_per_run")
      .eq("id", true)
      .maybeSingle();
    if (error) return 0;
    const n = Number((data as { candidate_rows_per_run?: number } | null)?.candidate_rows_per_run);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export interface CandidateRow {
  id: string;
  observation_key: string | null;
  instrument: string;
  direction: string | null;
  strategy_version: number;
  manifest_hash: string;
  detected_at: string;
  trading_session: string | null;
  volatility_index: number | null;
  grade: string | null;
  structure_key: string | null;
  entry_price: number | null;
  stop_loss: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  tp1_r: number | null;
  tp2_r: number | null;
  tp3_r: number | null;
  max_r: number | null;
  risk_price: number | null;
  atr: number | null;
  confidence_score: number | null;
  gates: unknown;
  gates_complete: boolean;
  enrolled_plan_id: string | null;
}

const CANDIDATE_COLUMNS =
  "id, observation_key, instrument, direction, strategy_version, manifest_hash, detected_at, " +
  "trading_session, volatility_index, grade, structure_key, entry_price, stop_loss, tp1, tp2, tp3, " +
  "tp1_r, tp2_r, tp3_r, max_r, risk_price, atr, confidence_score, gates, gates_complete, enrolled_plan_id";

function num(v: unknown): number | null {
  // NOTE: Number(null) is 0, so a missing value must be rejected BEFORE coercion
  // — otherwise an absent stop or target would read as a real price of zero.
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * A candidate is executable only when the ENTIRE plan was genuinely derived.
 * Anything short of that is left in the backlog forever rather than completed
 * with a guessed value.
 */
export function isExecutableCandidate(c: CandidateRow): boolean {
  if (!c.gates_complete) return false;
  if (c.direction !== "long" && c.direction !== "short") return false;
  if (!c.grade) return false;

  const gates = Array.isArray(c.gates) ? (c.gates as { outcome?: string }[]) : null;
  if (!gates) return false;
  if (gates.some((g) => g?.outcome === "not_evaluable")) return false;

  const required = [
    c.entry_price,
    c.stop_loss,
    c.tp1,
    c.tp2,
    c.tp3,
    c.tp1_r,
    c.tp2_r,
    c.tp3_r,
    c.max_r,
    c.atr,
  ].map(num);
  if (required.some((v) => v === null)) return false;

  const risk = num(c.risk_price);
  if (risk === null || risk <= 0) return false;
  const entry = num(c.entry_price)!;
  const stop = num(c.stop_loss)!;
  if (Math.abs(entry - stop) <= 0) return false;
  return true;
}

/** Candidate-namespaced structure claim. Never consumes a V2/V3 claim slot. */
async function claimCandidate(db: SupabaseClient, candidate: CandidateRow): Promise<boolean> {
  const key = `candidate:${candidate.structure_key ?? candidate.id}`;
  try {
    const { data, error } = await db.rpc("claim_v2_structure", {
      _model_version: CANDIDATE_CLAIM_NAMESPACE,
      _structure_key: key,
      _cooldown_minutes: CANDIDATE_CLAIM_COOLDOWN_MINUTES,
    });
    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}

export interface CandidateEnrolmentSummary {
  enabled: boolean;
  budget: number;
  considered: number;
  skippedNotExecutable: number;
  enrolled: number;
  failed: number;
}

const EMPTY: CandidateEnrolmentSummary = {
  enabled: false,
  budget: 0,
  considered: 0,
  skippedNotExecutable: 0,
  enrolled: 0,
  failed: 0,
};

/**
 * Enrol up to `budget` pending candidates. Returns counts; never throws.
 * Every failure path leaves production state untouched.
 */
export async function enrolPendingCandidates(
  db: SupabaseClient,
  deadlineMs = RESEARCH_WRITE_DEADLINE_MS,
): Promise<CandidateEnrolmentSummary> {
  try {
    if (!(await isCandidateEnrolmentEnabled(db))) return { ...EMPTY };
    const budget = await candidateEnrolmentBudget(db);
    if (budget <= 0) return { ...EMPTY, enabled: true, budget: 0 };

    const { data, error } = await db
      .from("research_candidates")
      .select(CANDIDATE_COLUMNS)
      .is("enrolled_plan_id", null)
      .eq("gates_complete", true)
      .not("entry_price", "is", null)
      .order("detected_at", { ascending: true })
      .limit(budget);
    if (error) {
      await noteResearchFailure(
        db,
        `candidate enrolment read failed: ${error.message}`,
        deadlineMs,
      );
      return { ...EMPTY, enabled: true, budget, failed: 1 };
    }

    const rows = (data ?? []) as unknown as CandidateRow[];
    const summary: CandidateEnrolmentSummary = {
      enabled: true,
      budget,
      considered: rows.length,
      skippedNotExecutable: 0,
      enrolled: 0,
      failed: 0,
    };

    for (const c of rows) {
      if (!isExecutableCandidate(c)) {
        summary.skippedNotExecutable += 1;
        continue;
      }
      if (!(await claimCandidate(db, c))) continue;

      const planId = crypto.randomUUID();
      const insert = await db.from("shadow_executions").insert({
        plan_id: planId,
        // Research rows are never backed by a published signal.
        signal_id: null,
        research_candidate_id: c.id,
        cohort: CANDIDATE_COHORT,
        replay_version: REPLAY_V1_VERSION,
        execution_policy: CANDIDATE_EXECUTION_POLICY,
        instrument: c.instrument,
        grade: c.grade,
        direction: c.direction,
        detected_at: c.detected_at,
        entry_price: c.entry_price,
        stop_loss: c.stop_loss,
        tp1: c.tp1,
        tp2: c.tp2,
        tp3: c.tp3,
        tp1_r: c.tp1_r,
        tp2_r: c.tp2_r,
        tp3_r: c.tp3_r,
        max_r: c.max_r,
        risk_price: c.risk_price,
        atr: c.atr,
        confidence_score: c.confidence_score,
        trading_session: c.trading_session,
        volatility_index: c.volatility_index,
        // Provenance: the candidate's own strategy version drives the model
        // stamp, so a candidate outcome can never be read as a V2/V3 result.
        model_version: c.strategy_version,
        observation_key: c.observation_key,
        quality_grade: c.grade,
        status: "pending",
        replay_cursor: c.detected_at,
        bars_replayed: 0,
      });

      if (insert.error) {
        if (/duplicate key|unique/i.test(insert.error.message)) continue;
        summary.failed += 1;
        await noteResearchFailure(
          db,
          `candidate enrolment insert failed: ${insert.error.message}`,
          deadlineMs,
        );
        continue;
      }

      // Only now does the candidate become "enrolled", and only if nothing else
      // claimed it in the meantime.
      const update = await db
        .from("research_candidates")
        .update({ enrolled_plan_id: planId, enrolled_at: new Date().toISOString() })
        .eq("id", c.id)
        .is("enrolled_plan_id", null);
      if (update.error) {
        summary.failed += 1;
        await noteResearchFailure(
          db,
          `candidate enrolment bookkeeping failed: ${update.error.message}`,
          deadlineMs,
        );
        continue;
      }
      summary.enrolled += 1;
    }

    return summary;
  } catch (err) {
    await noteResearchFailure(
      db,
      `candidate enrolment threw: ${err instanceof Error ? err.message : String(err)}`,
      deadlineMs,
    );
    return { ...EMPTY, failed: 1 };
  }
}
