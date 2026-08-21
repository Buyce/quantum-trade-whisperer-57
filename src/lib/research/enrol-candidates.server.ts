/**
 * Stage 4 — research-candidate enrolment (dark by default).
 *
 * Stage 3 records every evaluation the scanner performed. This module takes the
 * subset that carries a COMPLETE, pre-specified research plan and enrols it as a
 * forward-tested shadow execution in the `research_candidate` cohort, so a
 * filter's lift can eventually be measured against setups V1 rejected.
 *
 * Prompt 7G (red-team corrected):
 *  - Every enrolled execution uses the COMMON frozen research ladder
 *    (`cf_*` columns, `plan_origin='counterfactual'` on the execution), whether
 *    the candidate was published or filter-rejected. A gate's pass arm and fail
 *    arm are therefore replayed under one identical, filter-independent policy.
 *  - Executability is a fail-closed whitelist: the gate list must be complete,
 *    the counterfactual class must be `executable`, the ladder version must equal
 *    the current constant, at most one gate may have failed and that gate must be
 *    one of the three frozen filter gates, and every geometry/ladder value must
 *    be genuinely derived. NULL or unknown means "never executable".
 *  - Idempotency is enforced by the DATABASE:
 *    unique (research_candidate_id, replay_version, execution_policy, plan_origin).
 *    A unique violation is reconciled by adopting the existing execution's
 *    `plan_id`, so an insert-succeeded/bookkeeping-failed retry can never create
 *    a second execution. It never depends on the random plan_id or the claim.
 *  - Gated by `shadow_engine_state.candidate_enrolment_enabled`, which stays
 *    FALSE: with the switch off this is one flag read and a zeroed summary.
 *  - It never throws. A failure records durable research health and cannot
 *    affect production scanner or resolver state.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { REPLAY_V1_VERSION } from "@/lib/execution/replay-registry";
import { RESEARCH_PLAN_VERSION } from "./counterfactual-plan";
import { noteResearchFailure, RESEARCH_WRITE_DEADLINE_MS } from "./observations.server";

/** The only execution policy a research candidate may ever be replayed under. */
export const CANDIDATE_EXECUTION_POLICY = "legacy_best_target_touched";
/** The only cohort a research-candidate execution may carry. */
export const CANDIDATE_COHORT = "research_candidate";
/** Every research execution is a research-ladder plan, never a traded plan. */
export const CANDIDATE_PLAN_ORIGIN = "counterfactual";
/**
 * Candidate claims live in their OWN model_version namespace. V2 uses 2 and V3
 * uses 3; 101 can never collide with a research model's claim slot, so a
 * candidate claim cannot consume a V2/V3 claim or vice versa. It is a rate
 * limiter only — idempotency lives in the database unique index.
 */
export const CANDIDATE_CLAIM_NAMESPACE = 101;
/** Cooldown for the candidate claim slot, in minutes. */
export const CANDIDATE_CLAIM_COOLDOWN_MINUTES = 120;
/**
 * The only gates whose failure still leaves a fully derived entry/stop/risk/ATR.
 * Frozen: adding a gate here is a deliberate research-policy change.
 */
export const COUNTERFACTUAL_FAIL_GATES: readonly string[] = [
  "risk_ceiling",
  "headroom",
  "reachable_r",
];

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
  terminal_stage: string | null;
  grade: string | null;
  structure_key: string | null;
  entry_price: number | null;
  stop_loss: number | null;
  risk_price: number | null;
  atr: number | null;
  gates: unknown;
  gates_complete: boolean;
  enrolled_plan_id: string | null;
  /** How the PRODUCTION side of this row was derived. Reported, never grouped on. */
  plan_origin?: string | null;
  /** Which filter gate rejected the candidate, when one did. Reported only. */
  counterfactual_stage?: string | null;
  /** Whether a research plan can exist at all. NULL (legacy) means "no". */
  counterfactual_class?: string | null;
  /** The common research ladder. Every research execution uses these columns. */
  cf_tp1?: number | null;
  cf_tp2?: number | null;
  cf_tp3?: number | null;
  cf_tp1_r?: number | null;
  cf_tp2_r?: number | null;
  cf_tp3_r?: number | null;
  cf_max_r?: number | null;
  cf_grade?: string | null;
  cf_plan_version?: number | null;
}

const CANDIDATE_COLUMNS =
  "id, observation_key, instrument, direction, strategy_version, manifest_hash, detected_at, " +
  "trading_session, volatility_index, terminal_stage, grade, structure_key, entry_price, stop_loss, " +
  "risk_price, atr, gates, gates_complete, enrolled_plan_id, plan_origin, counterfactual_stage, " +
  "counterfactual_class, " +
  "cf_tp1, cf_tp2, cf_tp3, cf_tp1_r, cf_tp2_r, cf_tp3_r, cf_max_r, cf_grade, cf_plan_version";

function num(v: unknown): number | null {
  // NOTE: Number(null) is 0, so a missing value must be rejected BEFORE coercion
  // — otherwise an absent stop or target would read as a real price of zero.
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * A candidate is executable only when the ENTIRE research plan was genuinely
 * derived and the rejection (if any) is one the frozen policy can test.
 * Anything short of that is left in the backlog forever rather than completed
 * with a guessed value.
 */
export function isExecutableCandidate(c: CandidateRow): boolean {
  if (!c.gates_complete) return false;
  if (c.counterfactual_class !== "executable") return false;
  if (c.cf_plan_version !== RESEARCH_PLAN_VERSION) return false;
  if (c.direction !== "long" && c.direction !== "short") return false;
  if (!c.cf_grade) return false;

  const gates = Array.isArray(c.gates) ? (c.gates as { gate?: string; outcome?: string }[]) : null;
  if (!gates) return false;
  const failed = gates.filter((g) => g?.outcome === "fail");
  if (failed.length > 1) return false;
  if (failed.length === 1) {
    // A rejection is only testable when the failing gate is one of the three
    // frozen filter gates — everything else is structurally undefined.
    const gate = failed[0]?.gate ?? "";
    if (!COUNTERFACTUAL_FAIL_GATES.includes(gate)) return false;
  } else {
    // No failed gate at all: this can only be a published evaluation.
    if (c.terminal_stage !== "published") return false;
    if (gates.some((g) => g?.outcome === "not_evaluable")) return false;
  }

  const required = [
    c.entry_price,
    c.stop_loss,
    c.atr,
    c.cf_tp1,
    c.cf_tp2,
    c.cf_tp3,
    c.cf_tp1_r,
    c.cf_tp2_r,
    c.cf_tp3_r,
    c.cf_max_r,
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

/** Reads the existing research execution for a candidate, if any. */
async function existingExecutionPlanId(
  db: SupabaseClient,
  candidateId: string,
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from("shadow_executions")
      .select("plan_id")
      .eq("research_candidate_id", candidateId)
      .eq("replay_version", REPLAY_V1_VERSION)
      .eq("execution_policy", CANDIDATE_EXECUTION_POLICY)
      .eq("plan_origin", CANDIDATE_PLAN_ORIGIN)
      .limit(1);
    const rows = (data ?? []) as { plan_id?: string }[];
    if (error) return null;
    return rows[0]?.plan_id ?? null;
  } catch {
    return null;
  }
}

/** Writes bookkeeping only if nothing else claimed the candidate meanwhile. */
async function markEnrolled(
  db: SupabaseClient,
  candidateId: string,
  planId: string,
): Promise<string | null> {
  const { error } = await db
    .from("research_candidates")
    .update({ enrolled_plan_id: planId, enrolled_at: new Date().toISOString() })
    .eq("id", candidateId)
    .is("enrolled_plan_id", null);
  return error ? error.message : null;
}

export interface CandidateEnrolmentSummary {
  enabled: boolean;
  budget: number;
  considered: number;
  skippedNotExecutable: number;
  enrolled: number;
  enrolledCounterfactual: number;
  /** Existing execution adopted after a duplicate insert — no new row created. */
  reconciled: number;
  failed: number;
}

const EMPTY: CandidateEnrolmentSummary = {
  enabled: false,
  budget: 0,
  considered: 0,
  skippedNotExecutable: 0,
  enrolled: 0,
  enrolledCounterfactual: 0,
  reconciled: 0,
  failed: 0,
};

const isDuplicate = (message: string) => /duplicate key|unique|conflict/i.test(message);

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
      enrolledCounterfactual: 0,
      reconciled: 0,
      failed: 0,
    };

    for (const c of rows) {
      if (!isExecutableCandidate(c)) {
        summary.skippedNotExecutable += 1;
        continue;
      }

      // Reconcile first: an earlier attempt may have created the execution and
      // died before bookkeeping. Adopting it is always correct and never
      // creates a row.
      const orphan = await existingExecutionPlanId(db, c.id);
      if (orphan) {
        const bookkeeping = await markEnrolled(db, c.id, orphan);
        if (bookkeeping) {
          summary.failed += 1;
          await noteResearchFailure(
            db,
            `candidate enrolment reconciliation failed: ${bookkeeping}`,
            deadlineMs,
          );
          continue;
        }
        summary.reconciled += 1;
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
        plan_origin: CANDIDATE_PLAN_ORIGIN,
        replay_version: REPLAY_V1_VERSION,
        execution_policy: CANDIDATE_EXECUTION_POLICY,
        instrument: c.instrument,
        grade: c.cf_grade,
        direction: c.direction,
        detected_at: c.detected_at,
        entry_price: c.entry_price,
        stop_loss: c.stop_loss,
        // The COMMON research ladder — identical semantics on both arms.
        tp1: c.cf_tp1,
        tp2: c.cf_tp2,
        tp3: c.cf_tp3,
        tp1_r: c.cf_tp1_r,
        tp2_r: c.cf_tp2_r,
        tp3_r: c.cf_tp3_r,
        max_r: c.cf_max_r,
        risk_price: c.risk_price,
        atr: c.atr,
        // A research ladder has no production confidence score; inventing one
        // would make a research plan look graded.
        confidence_score: null,
        trading_session: c.trading_session,
        volatility_index: c.volatility_index,
        // Provenance: the candidate's own strategy version drives the model
        // stamp, so a candidate outcome can never be read as a V2/V3 result.
        model_version: c.strategy_version,
        observation_key: c.observation_key,
        quality_grade: c.cf_grade,
        status: "pending",
        replay_cursor: c.detected_at,
        bars_replayed: 0,
      });

      if (insert.error) {
        if (isDuplicate(insert.error.message)) {
          // The database refused a second execution for this candidate. Adopt
          // the one that already exists.
          const existing = await existingExecutionPlanId(db, c.id);
          if (existing) {
            const bookkeeping = await markEnrolled(db, c.id, existing);
            if (!bookkeeping) {
              summary.reconciled += 1;
              continue;
            }
            summary.failed += 1;
            await noteResearchFailure(
              db,
              `candidate enrolment reconciliation failed: ${bookkeeping}`,
              deadlineMs,
            );
          }
          continue;
        }
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
      const bookkeeping = await markEnrolled(db, c.id, planId);
      if (bookkeeping) {
        summary.failed += 1;
        await noteResearchFailure(
          db,
          `candidate enrolment bookkeeping failed: ${bookkeeping}`,
          deadlineMs,
        );
        continue;
      }
      summary.enrolled += 1;
      summary.enrolledCounterfactual += 1;
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
