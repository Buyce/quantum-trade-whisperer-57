import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase, type FakeCall } from "@/test/fakes/supabase";
import {
  CANDIDATE_CLAIM_NAMESPACE,
  CANDIDATE_COHORT,
  CANDIDATE_EXECUTION_POLICY,
  enrolPendingCandidates,
  isExecutableCandidate,
  type CandidateRow,
} from "../enrol-candidates.server";

/** A candidate with a COMPLETE, genuinely derived executable plan. */
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
    grade: "B",
    structure_key: "EURUSD|long|abc-1",
    entry_price: 1.1,
    stop_loss: 1.09,
    tp1: 1.11,
    tp2: 1.12,
    tp3: 1.13,
    tp1_r: 1,
    tp2_r: 2,
    tp3_r: 3,
    max_r: 3.4,
    risk_price: 0.01,
    atr: 0.004,
    confidence_score: 61,
    gates: [{ gate: "grade", outcome: "pass" }],
    gates_complete: true,
    enrolled_plan_id: null,
    ...overrides,
  };
}

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
  updateError?: string;
  readError?: string;
}): Scenario {
  const {
    enabled = true,
    budget = 5,
    candidates = [executable()],
    claim = true,
    insertError,
    updateError,
    readError,
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
      if (call.table === "shadow_executions" && call.op === "insert") {
        return insertError
          ? { data: null, error: { message: insertError } }
          : { data: null, error: null };
      }
      if (call.table === "research_candidates" && call.op === "update") {
        return updateError
          ? { data: null, error: { message: updateError } }
          : { data: null, error: null };
      }
      return { data: [], error: null };
    },
    () => ({ data: claim, error: null }),
  );

  return { db: fake.client as SupabaseClient, calls: fake.calls, rpcCalls: fake.rpcCalls };
}

const insertOf = (calls: FakeCall[]) =>
  calls.find((c) => c.table === "shadow_executions" && c.op === "insert")?.payload ?? null;

describe("Stage 4 candidate enrolment — executability", () => {
  it("[INVARIANT] a complete pre-specified plan is executable", () => {
    expect(isExecutableCandidate(executable())).toBe(true);
  });

  const incomplete: [string, Partial<CandidateRow>][] = [
    ["no entry", { entry_price: null }],
    ["no stop", { stop_loss: null }],
    ["no TP1", { tp1: null }],
    ["no TP3", { tp3: null }],
    ["no TP R values", { tp2_r: null }],
    ["no max R", { max_r: null }],
    ["no ATR", { atr: null }],
    ["zero risk", { risk_price: 0 }],
    ["no direction", { direction: null }],
    ["no grade", { grade: null }],
    ["incomplete gate list", { gates_complete: false }],
    ["a not_evaluable gate", { gates: [{ gate: "grade", outcome: "not_evaluable" }] }],
  ];

  it.each(incomplete)(
    "[INVARIANT] a candidate with %s can never become a trade",
    (_label, patch) => {
      expect(isExecutableCandidate(executable(patch))).toBe(false);
    },
  );

  it("[INVARIANT] a non-executable candidate is skipped and never inserted", async () => {
    const s = scenario({ candidates: [executable({ id: "c2", tp3: null })] });
    const summary = await enrolPendingCandidates(s.db);
    expect(summary.skippedNotExecutable).toBe(1);
    expect(summary.enrolled).toBe(0);
    expect(insertOf(s.calls)).toBeNull();
  });
});

describe("Stage 4 candidate enrolment — provenance and identity", () => {
  it("[INVARIANT] the execution row carries cohort, Replay-V1 and the explicit legacy policy", async () => {
    const s = scenario({});
    const summary = await enrolPendingCandidates(s.db);
    expect(summary.enrolled).toBe(1);
    const payload = insertOf(s.calls)!;
    expect(payload["cohort"]).toBe(CANDIDATE_COHORT);
    expect(payload["replay_version"]).toBe(1);
    expect(payload["execution_policy"]).toBe(CANDIDATE_EXECUTION_POLICY);
    expect(payload["research_candidate_id"]).toBe("cand-1");
    expect(payload["signal_id"]).toBeNull();
    expect(payload["model_version"]).toBe(1);
    expect(payload["observation_key"]).toBe("run-1|EURUSD");
  });

  it("[INVARIANT] no geometry is invented: every plan value comes from the candidate", async () => {
    const c = executable();
    const s = scenario({ candidates: [c] });
    await enrolPendingCandidates(s.db);
    const p = insertOf(s.calls)!;
    for (const key of [
      "entry_price",
      "stop_loss",
      "tp1",
      "tp2",
      "tp3",
      "tp1_r",
      "tp2_r",
      "tp3_r",
      "max_r",
      "risk_price",
      "atr",
    ] as const) {
      expect(p[key]).toBe(c[key]);
    }
  });

  it("[INVARIANT] claims use the candidate namespace, never a V2/V3 claim slot", async () => {
    const s = scenario({});
    await enrolPendingCandidates(s.db);
    const claims = s.rpcCalls.filter((r) => r.fn === "claim_v2_structure");
    expect(claims).toHaveLength(1);
    const args = claims[0]!.args as { _model_version: number; _structure_key: string };
    expect(args._model_version).toBe(CANDIDATE_CLAIM_NAMESPACE);
    expect(args._model_version).not.toBe(2);
    expect(args._model_version).not.toBe(3);
    expect(args._structure_key.startsWith("candidate:")).toBe(true);
  });

  it("[INVARIANT] enrolled_plan_id is written only after the execution row exists, and only while still NULL", async () => {
    const s = scenario({});
    await enrolPendingCandidates(s.db);
    const insertIdx = s.calls.findIndex(
      (c) => c.table === "shadow_executions" && c.op === "insert",
    );
    const updateIdx = s.calls.findIndex(
      (c) => c.table === "research_candidates" && c.op === "update",
    );
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeGreaterThan(insertIdx);
    const update = s.calls[updateIdx]!;
    expect(update.is["enrolled_plan_id"]).toBeNull();
    expect(update.payload!["enrolled_plan_id"]).toBe(insertOf(s.calls)!["plan_id"]);
  });

  it("[INVARIANT] a failed execution insert leaves the candidate unenrolled", async () => {
    const s = scenario({ insertError: "boom" });
    const summary = await enrolPendingCandidates(s.db);
    expect(summary.enrolled).toBe(0);
    expect(summary.failed).toBe(1);
    expect(s.calls.some((c) => c.table === "research_candidates" && c.op === "update")).toBe(false);
  });

  it("[INVARIANT] a duplicate identity is idempotent: no second enrolment, no failure", async () => {
    const s = scenario({ insertError: "duplicate key value violates unique constraint" });
    const summary = await enrolPendingCandidates(s.db);
    expect(summary.enrolled).toBe(0);
    expect(summary.failed).toBe(0);
    expect(s.calls.some((c) => c.table === "research_candidates" && c.op === "update")).toBe(false);
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
