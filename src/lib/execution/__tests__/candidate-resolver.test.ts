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

const { allFetchesFailedMessage, replayCandleDepthForRows, resolveShadowExecutions } =
  await import("../shadow_resolve.server");

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
    // Provider-symbol authority (R8): the resolver resolves the broker symbol
    // before fetching, proven by a fresh scanner-scope specification row.
    if (call.table === "broker_symbol_specs" && call.op === "select") {
      return {
        data: [
          {
            symbol: call.eq["symbol"] ?? "EURUSD",
            digits: 5,
            point: 0.00001,
            fetched_at: new Date().toISOString(),
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

  it("[INVARIANT] replay candle requests are bounded from the row cursor, not fixed at deep history", async () => {
    const fresh = row("fresh");
    fresh.detected_at = new Date().toISOString();
    fresh.replay_cursor = fresh.detected_at;
    const s = setup({ production: [fresh], candidates: [] });

    await resolveShadowExecutions(s.db);

    expect(fetchCandles.mock.calls[0]?.[2]).toBe(replayCandleDepthForRows([fresh]));
    expect(fetchCandles.mock.calls[0]?.[2]).toBeLessThan(200);
  });

  it("[INVARIANT] very stale replay rows cap at the live-scanner pressure ceiling", () => {
    const now = Date.parse("2026-08-25T12:00:00.000Z");
    expect(
      replayCandleDepthForRows(
        [{ detected_at: "2026-08-01T00:00:00.000Z", replay_cursor: "2026-08-01T00:00:00.000Z" }],
        now,
      ),
    ).toBe(200);
  });

  it("[INVARIANT] provider candle failure preserves open rows and records a truthful failed fetch", async () => {
    fetchCandles.mockRejectedValueOnce(new Error("MetaApi request for EURUSD M15 exceeded 8000ms"));
    const open = row("p1");
    const s = setup({ production: [open], candidates: [] });

    const summary = await resolveShadowExecutions(s.db);

    expect(summary.fetchFailures).toBe(1);
    expect(summary.advanced).toBe(0);
    expect(summary.resolved).toBe(0);
    expect(summary.instruments[0]).toMatchObject({ instrument: "EURUSD", candles: 0 });
    expect(s.calls.some((c) => c.table === "shadow_executions" && c.op === "update")).toBe(false);
  });

  it("[UNIT] all-fetch-failed summary includes bounded per-instrument reasons", () => {
    const message = allFetchesFailedMessage({
      scanned: 2,
      advanced: 0,
      resolved: 0,
      instruments: [
        { instrument: "EURUSD", candles: 0, requested: 98, error: "timeout after 8000ms" },
        { instrument: "XAUUSD", candles: 0, requested: 98, error: "HTTP 504" },
      ],
      fetchFailures: 2,
      researchScanned: 0,
      researchAdvanced: 0,
      candidateScanned: 0,
      candidateAdvanced: 0,
      candidateBacklogNoCandles: 0,
      candidateOutsideWindow: 0,
      candidateBackfillFetches: 0,
    });

    expect(message).toContain("All instrument candle fetches failed");
    expect(message).toContain("EURUSD: timeout after 8000ms");
    expect(message).toContain("XAUUSD: HTTP 504");
  });

  it("[UNIT] lifecycle or mapping refusals alone are not treated as provider-wide fetch failure", () => {
    expect(
      allFetchesFailedMessage({
        scanned: 1,
        advanced: 0,
        resolved: 0,
        instruments: [{ instrument: "AUDUSD", candles: 0, error: "not in service" }],
        fetchFailures: 0,
        researchScanned: 0,
        researchAdvanced: 0,
        candidateScanned: 0,
        candidateAdvanced: 0,
        candidateBacklogNoCandles: 0,
        candidateOutsideWindow: 0,
        candidateBackfillFetches: 0,
      }),
    ).toBeNull();
  });
});
