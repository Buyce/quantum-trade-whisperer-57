/**
 * Blocking tests for the V2 shadow enrolment path (Prompt 3F).
 *
 * Classes:
 *  [INVARIANT] research enrolment can never publish, and can never change the
 *              V1 job outcome.
 *  [UNIT]      the gating rules: kill switch, family, structure claim.
 *
 * No MetaApi calls, no randomness, no real database: the Supabase client is a
 * recording double and both graders are stubbed so the assertions are about
 * control flow only, never about grading math.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const v1Result = { value: null as unknown };
const v2Result = { value: null as unknown, throws: null as string | null };

vi.mock("../metaapi.server", () => ({
  fetchCandles: vi.fn(async () => [{ time: "2026-08-01T00:00:00.000Z", o: 1, h: 1, l: 1, c: 1 }]),
  MetaApiNotConfiguredError: class extends Error {},
  MetaApiTimeoutError: class extends Error {},
}));

vi.mock("../profile", () => ({
  buildTradeProfile: vi.fn(() => v1Result.value),
}));

vi.mock("../v2/profile.v2", () => ({
  buildTradeProfileV2: vi.fn(() => {
    if (v2Result.throws) throw new Error(v2Result.throws);
    return v2Result.value;
  }),
}));

const { processNextJob } = await import("../pipeline.server");

const CANDIDATE_PROFILE = {
  instrument: "EURUSD",
  direction: "long" as const,
  family: "continuation" as const,
  grade: "A" as const,
  entryPrice: 1.1,
  stopLoss: 1.09,
  tp1: 1.12,
  tp2: 1.13,
  tp3: 1.14,
  tp1R: 2,
  tp2R: 3,
  tp3R: 4,
  maxR: 4,
  rrRatio: 2,
  maxAcceptableEntry: 1.101,
  capped: false,
  atr: 0.004,
  retracement: 0.6,
  patternSymmetry: 0.8,
  headroomAtr: 3,
  barrierSource: "structure" as const,
  structureKey: "EURUSD|long|abc",
  pillarsPassed: 3,
  pTrend: 1,
  pOrderBlock: 1,
  pMomentum: 1,
  pVolatilityExpansion: 0,
  reasons: [],
};

const v2Candidate = (overrides: Record<string, unknown> = {}) => ({
  modelVersion: 2,
  decision: "candidate",
  observationOnly: false,
  reason: "candidate",
  profile: CANDIDATE_PROFILE,
  ...overrides,
});

interface Recorded {
  table: string;
  op: string;
  payload: unknown;
}

interface FakeOptions {
  v2Enabled?: boolean;
  claim?: boolean;
  duplicate?: boolean;
  shadowInsertError?: string;
}

/**
 * Chainable Supabase double: every builder method returns itself, awaiting
 * resolves to the configured result for that table/operation.
 */
function fakeDb(opts: FakeOptions) {
  const recorded: Recorded[] = [];

  const result = (table: string, op: string, payload: unknown) => {
    recorded.push({ table, op, payload });
    if (table === "shadow_executions" && op === "insert" && opts.shadowInsertError) {
      return { data: null, error: { message: opts.shadowInsertError, code: "XX000" } };
    }
    if (table === "shadow_engine_state" && op === "select") {
      return { data: { v2_enabled: opts.v2Enabled ?? false, research_errors: 0 }, error: null };
    }
    if (table === "scanned_signals" && op === "select") {
      return { data: opts.duplicate ? [{ id: "existing" }] : [], error: null };
    }
    return { data: [], error: null };
  };

  const builder = (table: string) => {
    let op = "select";
    let payload: unknown = null;
    const chain: Record<string, unknown> = {};
    const settle = () => result(table, op, payload);
    for (const method of [
      "select",
      "insert",
      "update",
      "upsert",
      "delete",
      "eq",
      "neq",
      "in",
      "gte",
      "lte",
      "gt",
      "lt",
      "is",
      "not",
      "order",
      "limit",
      "maybeSingle",
      "single",
    ]) {
      chain[method] = (arg: unknown) => {
        if (["select", "insert", "update", "upsert", "delete"].includes(method)) {
          op = method;
          if (method !== "select") payload = arg;
        }
        if (method === "maybeSingle" || method === "single") {
          const r = settle();
          const data = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
          return Promise.resolve({ ...r, data });
        }
        return chain;
      };
    }
    chain["then"] = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown): unknown =>
      Promise.resolve(settle()).then(resolve, reject);
    return chain;
  };

  const db = {
    from: (table: string) => builder(table),
    rpc: (fn: string, args?: unknown) => {
      recorded.push({ table: `rpc:${fn}`, op: "rpc", payload: args });
      if (fn === "claim_scan_job") {
        return Promise.resolve({
          data: [
            {
              id: "job-1",
              instrument: "EURUSD",
              enqueued_at: new Date().toISOString(),
              run_id: "11111111-2222-3333-4444-555555555555",
            },
          ],
          error: null,
        });
      }
      if (fn === "claim_v2_structure") {
        return Promise.resolve({ data: opts.claim ?? true, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as SupabaseClient;

  return { db, recorded };
}

const shadowInserts = (recorded: Recorded[]) =>
  recorded.filter((r) => r.table === "shadow_executions" && r.op === "insert");
const observationWrites = (recorded: Recorded[]) =>
  recorded.filter((r) => r.table === "model_observations");
const signalInserts = (recorded: Recorded[]) =>
  recorded.filter((r) => r.table === "scanned_signals" && r.op === "insert");

beforeEach(() => {
  v1Result.value = null;
  v2Result.value = v2Candidate();
  v2Result.throws = null;
});

describe("V2 shadow enrolment gating", () => {
  it("[UNIT] V1 no-trade + V2 candidate enrols exactly one V2 shadow row", async () => {
    const { db, recorded } = fakeDb({ v2Enabled: true, claim: true });
    const job = await processNextJob(db);
    expect(job?.status).toBe("no_trade");

    const inserts = shadowInserts(recorded);
    expect(inserts).toHaveLength(1);
    const row = inserts[0]?.payload as Record<string, unknown>;
    expect(row["model_version"]).toBe(2);
    expect(row["status"]).toBe("pending");
    expect(row["signal_id"]).toBeNull();
    expect(row["strategy_family"]).toBe("continuation");
    expect(row["quality_grade"]).toBe("A");
    expect(row["entry_price"]).toBe(CANDIDATE_PROFILE.entryPrice);
    expect(row["stop_loss"]).toBe(CANDIDATE_PROFILE.stopLoss);
    expect(row["tp1"]).toBe(CANDIDATE_PROFILE.tp1);
    expect(row["tp3_r"]).toBe(CANDIDATE_PROFILE.tp3R);
    expect(row["max_r"]).toBe(CANDIDATE_PROFILE.maxR);
    expect(row["observation_key"]).toBeTruthy();
  });

  it("[INVARIANT] v2_enabled = false produces zero V2 enrolments", async () => {
    const { db, recorded } = fakeDb({ v2Enabled: false, claim: true });
    await processNextJob(db);
    expect(shadowInserts(recorded)).toHaveLength(0);
  });

  it("[UNIT] a lost structure claim produces no enrolment", async () => {
    const { db, recorded } = fakeDb({ v2Enabled: true, claim: false });
    await processNextJob(db);
    expect(shadowInserts(recorded)).toHaveLength(0);
  });

  it("[UNIT] the mean-reversion family is observation-only and never enrols", async () => {
    v2Result.value = v2Candidate({
      observationOnly: true,
      profile: { ...CANDIDATE_PROFILE, family: "mean_reversion", grade: "C" },
    });
    const { db, recorded } = fakeDb({ v2Enabled: true, claim: true });
    await processNextJob(db);
    expect(shadowInserts(recorded)).toHaveLength(0);
    expect(observationWrites(recorded).length).toBeGreaterThan(0);
  });

  it("[UNIT] a V1 cooldown duplicate still enrols the V2 candidate when the claim wins", async () => {
    v1Result.value = {
      instrument: "EURUSD",
      grade: "B",
      direction: "long",
      structureKey: "EURUSD|long|v1",
    };
    const { db, recorded } = fakeDb({ v2Enabled: true, claim: true, duplicate: true });
    const job = await processNextJob(db);
    expect(job?.status).toBe("duplicate");
    expect(shadowInserts(recorded)).toHaveLength(1);
    expect(signalInserts(recorded)).toHaveLength(0);
  });

  it("[INVARIANT] a failing V2 shadow insert does not alter the V1 job result", async () => {
    const { db, recorded } = fakeDb({
      v2Enabled: true,
      claim: true,
      shadowInsertError: "simulated research failure",
    });
    const job = await processNextJob(db);
    expect(job?.status).toBe("no_trade");
    expect(shadowInserts(recorded)).toHaveLength(1);
    // Health is recorded durably rather than thrown.
    expect(recorded.some((r) => r.table === "shadow_engine_state" && r.op === "update")).toBe(true);
  });

  it("[INVARIANT] a V2 evaluator crash is preserved as a durable error observation", async () => {
    v2Result.throws = "evaluator exploded";
    const { db, recorded } = fakeDb({ v2Enabled: true, claim: true });
    const job = await processNextJob(db);
    expect(job?.status).toBe("no_trade");

    const writes = observationWrites(recorded);
    expect(writes).toHaveLength(1);
    const rows = writes[0]?.payload as Array<Record<string, unknown>>;
    const v2Row = rows.find((r) => r["model_version"] === 2);
    expect(v2Row?.["decision"]).toBe("error");
    expect(String(v2Row?.["reason"])).toContain("evaluator exploded");
    expect(shadowInserts(recorded)).toHaveLength(0);
  });

  it("[INVARIANT] observation persistence upserts on the run identity, so retries cannot double-count", async () => {
    const { db, recorded } = fakeDb({ v2Enabled: true, claim: true });
    await processNextJob(db);
    const writes = observationWrites(recorded);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.op).toBe("upsert");
  });

  it("[INVARIANT] no V2 row is ever written to a live signal surface", async () => {
    const { db, recorded } = fakeDb({ v2Enabled: true, claim: true });
    await processNextJob(db);
    for (const write of recorded) {
      if (write.op !== "insert" && write.op !== "upsert") continue;
      if (write.table === "shadow_executions" || write.table === "model_observations") continue;
      const rows = Array.isArray(write.payload) ? write.payload : [write.payload];
      for (const row of rows) {
        expect((row as Record<string, unknown> | null)?.["model_version"]).not.toBe(2);
      }
    }
  });
});
