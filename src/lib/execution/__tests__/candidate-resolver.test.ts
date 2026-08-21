/**
 * Candidate resolution must be invisible to production: it may not consume a
 * production replay slot and it may not cause a single extra broker fetch.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase, type FakeCall } from "@/test/fakes/supabase";

const fetchCandles = vi.fn();
vi.mock("@/lib/scanner/metaapi.server", () => ({
  fetchCandles: (...args: unknown[]) => fetchCandles(...args),
}));

const { resolveShadowExecutions } = await import("../shadow_resolve.server");

const DETECTED = "2026-08-20T08:00:00.000Z";

function candles(from: number) {
  return Array.from({ length: 40 }, (_, i) => {
    const close = from + i * 0.0005;
    return {
      time: new Date(new Date(DETECTED).getTime() + (i + 1) * 15 * 60_000).toISOString(),
      open: close,
      high: close + 0.0008,
      low: close - 0.0008,
      close,
    };
  });
}

function row(id: string, instrument = "EURUSD") {
  return {
    id,
    signal_id: `sig-${id}`,
    instrument,
    direction: "long",
    detected_at: DETECTED,
    entry_price: 1.1,
    stop_loss: 1.09,
    tp1: 1.105,
    tp2: 1.11,
    tp3: null,
    tp1_r: 1,
    tp2_r: 2,
    tp3_r: null,
    risk_price: 0.01,
    atr: 0.004,
    filled_at: null,
    fill_price: null,
    execution_slippage_pips: null,
    status: "pending",
    replay_cursor: DETECTED,
    bars_replayed: 0,
    max_favorable_excursion_r: null,
    max_adverse_excursion_r: null,
  };
}

interface Setup {
  db: SupabaseClient;
  calls: FakeCall[];
}

function setup(opts: { production: unknown[]; candidates: unknown[]; budget?: number }): Setup {
  const fake = createFakeSupabase((call) => {
    if (call.table === "shadow_engine_state") {
      return {
        data: [
          {
            replay_v2_shadow_enabled: false,
            candidate_rows_per_run: opts.budget ?? 30,
          },
        ],
        error: null,
      };
    }
    if (call.table === "shadow_executions" && call.op === "select") {
      if (call.eq["cohort"] === "research_candidate") return { data: opts.candidates, error: null };
      if (call.eq["cohort"] === "production" && call.eq["model_version"] === 1) {
        return { data: opts.production, error: null };
      }
      return { data: [], error: null };
    }
    return { data: [], error: null };
  });
  return { db: fake.client as SupabaseClient, calls: fake.calls };
}

beforeEach(() => {
  fetchCandles.mockReset();
  fetchCandles.mockResolvedValue(candles(1.1));
});

describe("candidate resolution capacity and provider budget", () => {
  it("[INVARIANT] the production query is cohort-scoped and its limit is untouched by candidate backlog", async () => {
    const s = setup({
      production: [row("p1")],
      candidates: Array.from({ length: 25 }, (_, i) => row(`c${i}`)),
    });
    await resolveShadowExecutions(s.db);
    const productionReads = s.calls.filter(
      (c) =>
        c.table === "shadow_executions" && c.op === "select" && c.eq["cohort"] === "production",
    );
    expect(productionReads.length).toBeGreaterThan(0);
    // The FIRST production read still asks for the full 200 slots, and every
    // later model cohort is reduced only by production rows already loaded —
    // never by candidate backlog, however deep it is.
    expect(productionReads[0]!.limit).toBe(200);
    expect(productionReads[1]!.limit).toBe(199);
    for (const read of productionReads) {
      expect(read.eq["cohort"]).toBe("production");
    }
  });

  it("[INVARIANT] the candidate query is bounded by its own database budget", async () => {
    const s = setup({ production: [row("p1")], candidates: [row("c1")], budget: 7 });
    await resolveShadowExecutions(s.db);
    const candidateRead = s.calls.find(
      (c) =>
        c.table === "shadow_executions" &&
        c.op === "select" &&
        c.eq["cohort"] === "research_candidate",
    )!;
    expect(candidateRead.limit).toBe(7);
    expect(candidateRead.eq["replay_version"]).toBe(1);
  });

  it("[INVARIANT] candidate replay causes zero incremental broker fetches", async () => {
    const withoutCandidates = setup({ production: [row("p1")], candidates: [] });
    await resolveShadowExecutions(withoutCandidates.db);
    const baseline = fetchCandles.mock.calls.length;

    fetchCandles.mockClear();
    const withCandidates = setup({
      production: [row("p1")],
      candidates: [row("c1"), row("c2"), row("c3")],
    });
    const summary = await resolveShadowExecutions(withCandidates.db);

    expect(fetchCandles.mock.calls.length).toBe(baseline);
    expect(summary.candidateScanned).toBe(3);
    expect(summary.candidateAdvanced).toBeGreaterThan(0);
  });

  it("[INVARIANT] a candidate on an instrument production is not fetching is counted, never fetched for", async () => {
    const s = setup({ production: [row("p1", "EURUSD")], candidates: [row("c1", "XAUUSD")] });
    const summary = await resolveShadowExecutions(s.db);
    expect(fetchCandles.mock.calls.map((c) => c[0])).toEqual(["EURUSD"]);
    expect(summary.candidateBacklogNoCandles).toBe(1);
    expect(summary.candidateAdvanced).toBe(0);
  });

  it("[INVARIANT] a zero candidate budget reads no candidate rows at all", async () => {
    const s = setup({ production: [row("p1")], candidates: [row("c1")], budget: 0 });
    const summary = await resolveShadowExecutions(s.db);
    expect(summary.candidateScanned).toBe(0);
    expect(s.calls.some((c) => c.op === "select" && c.eq["cohort"] === "research_candidate")).toBe(
      false,
    );
  });
});
