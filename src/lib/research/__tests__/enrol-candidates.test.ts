import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase, type FakeCall } from "@/test/fakes/supabase";
import {
  CANDIDATE_CLAIM_NAMESPACE,
  CANDIDATE_COHORT,
  CANDIDATE_EXECUTION_POLICY,
  CANDIDATE_PLAN_ORIGIN,
  enrolPendingCandidates,
  isExecutableCandidate,
  type CandidateRow,
} from "../enrol-candidates.server";

/** A candidate carrying a COMPLETE, genuinely derived common research ladder. */
function executable(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id: "cand-1",
    observation_key: "run-1|EURUSD",
    instrument: "EURUSD",
    direction: "long",
    strategy_version: 1,
    manifest_hash: "hash-1",
    detected_at: "2026-08-20T10:00:00.000Z",
    trading_session: "london",
    volatility_index: 1.1,
    terminal_stage: "no_headroom",
    grade: null,
    structure_key: "EURUSD|long|abc-1",
    entry_price: 1.1,
    stop_loss: 1.09,
    risk_price: 0.01,
    atr: 0.004,
    gates: [
      { gate: "grade", outcome: "pass" },
      { gate: "headroom", outcome: "fail" },
    ],
    gates_complete: true,
    enrolled_plan_id: null,
    plan_origin: "counterfactual",
    counterfactual_class: "executable",
    cf_tp1: 1.11,
    cf_tp2: 1.12,
    cf_tp3: 1.13,
    cf_tp1_r: 1,
    cf_tp2_r: 2,
    cf_tp3_r: 3,
    cf_max_r: 3,
    cf_grade: "B",
    cf_plan_version: 1,
    ...overrides,
  };
}

/** A published candidate replayed under the SAME frozen research ladder. */
const published = (o: Partial<CandidateRow> = {}) =>
  executable({
    id: "cand-pub",
    terminal_stage: "published",
    plan_origin: "production",
    counterfactual_stage: null,
    gates: [{ gate: "headroom", outcome: "pass" }],
    ...o,
  });

interface Scenario {
  db: SupabaseClient;
  calls: FakeCall[];
  rpcCalls: { fn: string; args: unknown }[];
}

function scenario(opts: {
  enabled?: boolean;
  budget?: number;
  candidates?: CandidateRow[];
  claim?: boolean;
  insertError?: string;
  readError?: string;
  existingPlanId?: string | null;
}): Scenario {
  const {
    enabled = true,
    budget = 5,
    candidates = [executable()],
    claim = true,
    insertError,
    readError,
    existingPlanId = null,
  } = opts;

  const fake = createFakeSupabase(
    (call) => {
      if (call.table === "shadow_engine_state" && call.op === "select") {
        return {
          data: [
            {
              candidate_enrolment_enabled: enabled,
              candidate_rows_per_run: budget,
              research_errors: 0,
            },
          ],
          error: null,
        };
      }
      if (call.table === "shadow_engine_state") return { data: null, error: null };
      if (call.table === "research_candidates" && call.op === "select") {
        return readError
          ? { data: null, error: { message: readError } }
          : { data: candidates, error: null };
      }
      return { data: [], error: null };
    },
    (fn) => {
      if (fn !== "enrol_research_candidate_shadow") return { data: true, error: null };
      if (insertError) return { data: null, error: { message: insertError } };
      if (existingPlanId) {
        return {
          data: { inserted: false, reconciled: true, reason: null, plan_id: existingPlanId },
          error: null,
        };
      }
      if (!claim) {
        return {
          data: { inserted: false, reconciled: false, reason: "claim_lost", plan_id: null },
          error: null,
        };
      }
      return {
        data: { inserted: true, reconciled: false, reason: null, plan_id: "plan-new" },
        error: null,
      };
    },
  );

  return { db: fake.client as SupabaseClient, calls: fake.calls, rpcCalls: fake.rpcCalls };
}

const insertOf = (calls: FakeCall[]) =>
  calls.find((c) => c.table === "shadow_executions" && c.op === "insert")?.payload ?? null;

const enrolRpcOf = (s: Scenario) =>
  s.rpcCalls.find((r) => r.fn === "enrol_research_candidate_shadow");

describe("Stage 4 candidate enrolment — executability", () => {
  it("[INVARIANT] a complete pre-specified plan is executable", () => {
    expect(isExecutableCandidate(executable())).toBe(true);
  });

  const incomplete: [string, Partial<CandidateRow>][] = [
    ["no entry", { entry_price: null }],
    ["no stop", { stop_loss: null }],
    ["no research TP1", { cf_tp1: null }],
    ["no research TP3", { cf_tp3: null }],
    ["no research R values", { cf_tp2_r: null }],
    ["no research max R", { cf_max_r: null }],
    ["no ATR", { atr: null }],
    ["zero risk", { risk_price: 0 }],
    ["no direction", { direction: null }],
    ["no research grade", { cf_grade: null }],
    ["an unpinned ladder version", { cf_plan_version: null }],
    ["a future ladder version", { cf_plan_version: 2 }],
    ["incomplete gate list", { gates_complete: false }],
    ["a structurally undefined class", { counterfactual_class: "structurally_not_evaluable" }],
    ["a legacy NULL class", { counterfactual_class: null }],
    [
      "a rejection outside the frozen whitelist",
      { gates: [{ gate: "abc_structure", outcome: "fail" }] },
    ],
    [
      "two failed gates",
      {
        gates: [
          { gate: "headroom", outcome: "fail" },
          { gate: "reachable_r", outcome: "fail" },
        ],
      },
    ],
    [
      "no failed gate but no publication either",
      { terminal_stage: "no_headroom", gates: [{ gate: "headroom", outcome: "pass" }] },
    ],
    [
      "a not_evaluable gate on the published arm",
      {
        terminal_stage: "published",
        gates: [{ gate: "headroom", outcome: "not_evaluable" }],
      },
    ],
  ];

  it.each(incomplete)(
    "[INVARIANT] a candidate with %s can never become a trade",
    (_label, patch) => {
      expect(isExecutableCandidate(executable(patch))).toBe(false);
    },
  );

  it("[INVARIANT] a non-executable candidate is skipped and never inserted", async () => {
    const s = scenario({ candidates: [executable({ id: "c2", cf_tp3: null })] });
    const summary = await enrolPendingCandidates(s.db);
    expect(summary.skippedNotExecutable).toBe(1);
    expect(summary.enrolled).toBe(0);
    expect(insertOf(s.calls)).toBeNull();
  });
});

describe("Stage 4 candidate enrolment — provenance and identity", () => {
  it("[INVARIANT] the atomic RPC carries cohort, Replay-V1 and the explicit legacy policy", async () => {
    const s = scenario({});
    const summary = await enrolPendingCandidates(s.db);
    expect(summary.enrolled).toBe(1);
    const rpc = enrolRpcOf(s)!;
    const args = rpc.args as Record<string, unknown>;
    expect(args["_cohort"]).toBe(CANDIDATE_COHORT);
    expect(args["_replay_version"]).toBe(1);
    expect(args["_execution_policy"]).toBe(CANDIDATE_EXECUTION_POLICY);
    expect(args["_candidate_id"]).toBe("cand-1");
    expect(args["_plan_origin"]).toBe(CANDIDATE_PLAN_ORIGIN);
    expect(insertOf(s.calls)).toBeNull();
  });

  it("[INVARIANT] geometry is not invented client-side: only the candidate id crosses the boundary", async () => {
    const c = executable();
    const s = scenario({ candidates: [c] });
    await enrolPendingCandidates(s.db);
    const args = enrolRpcOf(s)!.args as Record<string, unknown>;
    expect(args["_candidate_id"]).toBe(c.id);
    for (const key of [
      "entry_price",
      "stop_loss",
      "risk_price",
      "atr",
      "tp1",
      "tp2",
      "tp3",
      "grade",
    ]) {
      expect(key in args).toBe(false);
    }
    expect(insertOf(s.calls)).toBeNull();
  });

  it("[INVARIANT] both filter arms are replayed under one identical atomic policy", async () => {
    const fail = scenario({ candidates: [executable()] });
    await enrolPendingCandidates(fail.db);
    const pass = scenario({ candidates: [published()] });
    const summary = await enrolPendingCandidates(pass.db);
    expect(summary.enrolled).toBe(1);

    const a = enrolRpcOf(fail)!.args as Record<string, unknown>;
    const b = enrolRpcOf(pass)!.args as Record<string, unknown>;
    for (const key of ["_plan_origin", "_execution_policy", "_replay_version", "_cohort"] as const) {
      expect(b[key]).toBe(a[key]);
    }
  });

  it("[INVARIANT] claims use the candidate namespace, never a V2/V3 claim slot", async () => {
    const s = scenario({});
    await enrolPendingCandidates(s.db);
    const args = enrolRpcOf(s)!.args as Record<string, unknown>;
    expect(args["_claim_model_version"]).toBe(CANDIDATE_CLAIM_NAMESPACE);
    expect(args["_claim_model_version"]).not.toBe(2);
    expect(args["_claim_model_version"]).not.toBe(3);
  });

  it("[INVARIANT] enrolled_plan_id bookkeeping is owned by the atomic RPC", async () => {
    const s = scenario({});
    await enrolPendingCandidates(s.db);
    expect(s.calls.some((c) => c.table === "shadow_executions" && c.op === "insert")).toBe(false);
    expect(s.calls.some((c) => c.table === "research_candidates" && c.op === "update")).toBe(false);
    expect(enrolRpcOf(s)).toBeTruthy();
  });

  it("[INVARIANT] a failed atomic enrolment leaves the candidate unenrolled", async () => {
    const s = scenario({ insertError: "boom" });
    const summary = await enrolPendingCandidates(s.db);
    expect(summary.enrolled).toBe(0);
    expect(summary.failed).toBe(1);
    expect(s.calls.some((c) => c.table === "research_candidates" && c.op === "update")).toBe(false);
  });

  it("[INVARIANT] a duplicate identity is idempotent: no second enrolment, no failure", async () => {
    const s = scenario({ existingPlanId: "plan-existing" });
    const summary = await enrolPendingCandidates(s.db);
    expect(summary.enrolled).toBe(0);
    expect(summary.reconciled).toBe(1);
    expect(summary.failed).toBe(0);
    expect(s.calls.some((c) => c.table === "research_candidates" && c.op === "update")).toBe(false);
  });

  it("[INVARIANT] a crashed retry adopts the existing execution inside the RPC", async () => {
    const s = scenario({ existingPlanId: "plan-existing" });
    const summary = await enrolPendingCandidates(s.db);
    expect(summary.reconciled).toBe(1);
    expect(summary.enrolled).toBe(0);
    expect(summary.failed).toBe(0);
    expect(insertOf(s.calls)).toBeNull();
  });

  it("[INVARIANT] reconciliation is scoped to the exact research execution identity", async () => {
    const s = scenario({ existingPlanId: "plan-existing" });
    await enrolPendingCandidates(s.db);
    const args = enrolRpcOf(s)!.args as Record<string, unknown>;
    expect(args["_candidate_id"]).toBe("cand-1");
    expect(args["_replay_version"]).toBe(1);
    expect(args["_execution_policy"]).toBe(CANDIDATE_EXECUTION_POLICY);
    expect(args["_plan_origin"]).toBe(CANDIDATE_PLAN_ORIGIN);
  });

  it("[INVARIANT] a lost claim enrols nothing at all", async () => {
    const s = scenario({ claim: false });
    const summary = await enrolPendingCandidates(s.db);
    expect(summary.enrolled).toBe(0);
    expect(insertOf(s.calls)).toBeNull();
  });

  it("[INVARIANT] only candidates that are not yet enrolled are considered", async () => {
    const s = scenario({});
    await enrolPendingCandidates(s.db);
    const read = s.calls.find((c) => c.table === "research_candidates" && c.op === "select")!;
    expect(read.is["enrolled_plan_id"]).toBeNull();
    expect(read.eq["gates_complete"]).toBe(true);
    expect(read.notIs).toContain("entry_price");
  });
});

describe("Stage 4 candidate enrolment — switches and blast radius", () => {
  it("[INVARIANT] the enrolment switch fails closed when disabled", async () => {
    const s = scenario({ enabled: false });
    const summary = await enrolPendingCandidates(s.db);
    expect(summary).toMatchObject({ enabled: false, enrolled: 0, considered: 0 });
    expect(s.calls.some((c) => c.table === "research_candidates")).toBe(false);
    expect(s.calls.some((c) => c.table === "shadow_executions")).toBe(false);
  });

  it("[INVARIANT] a zero budget enrols nothing", async () => {
    const s = scenario({ budget: 0 });
    const summary = await enrolPendingCandidates(s.db);
    expect(summary.enrolled).toBe(0);
    expect(s.calls.some((c) => c.table === "shadow_executions")).toBe(false);
  });

  it("[INVARIANT] the candidate read is bounded by the database budget", async () => {
    const s = scenario({ budget: 3 });
    await enrolPendingCandidates(s.db);
    const read = s.calls.find((c) => c.table === "research_candidates" && c.op === "select")!;
    expect(read.limit).toBe(3);
  });

  it("[INVARIANT] a read failure is recorded and never thrown into production", async () => {
    const s = scenario({ readError: "read exploded" });
    const summary = await enrolPendingCandidates(s.db);
    expect(summary.failed).toBe(1);
    expect(summary.enrolled).toBe(0);
  });

  it("[INVARIANT] enrolment never writes to scanned_signals or any trader-visible table", async () => {
    const s = scenario({});
    await enrolPendingCandidates(s.db);
    const written = new Set(s.calls.filter((c) => c.op !== "select").map((c) => c.table));
    expect(written.has("scanned_signals")).toBe(false);
    expect(written.has("executed_trades")).toBe(false);
    expect(written.has("market_context")).toBe(false);
  });
});
