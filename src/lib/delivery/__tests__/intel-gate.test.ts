/**
 * The intelligence gate must be reduce-only, off by default, and honest about a
 * thin sample. These tests pin all three, plus the fact that every enqueue
 * decision — including each refusal — is recorded.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase, type FakeCall } from "@/test/fakes/supabase";
import { evaluateIntelGate, gateConfigured } from "../intel-gate";
import { enqueueDirectDeliveries } from "../direct-enqueue.server";

const NOW = Date.parse("2026-08-24T12:00:00.000Z");

const STATS = [
  {
    tier: 1,
    regime_key: "global",
    instrument: null,
    direction: null,
    session: null,
    vol_bucket: null,
    n_total: 400,
    n_filled: 200,
    p_fill_shrunk: 0.5,
    p_win_shrunk: 0.62,
    vol_t1: null,
    vol_t2: null,
  },
] as never[];

describe("evaluateIntelGate", () => {
  it("[INVARIANT] does nothing while disabled or unconfigured", () => {
    for (const settings of [
      { enabled: false, minWinPct: 90, minSample: 30 },
      { enabled: true, minWinPct: null, minSample: 30 },
      { enabled: true, minWinPct: 0, minSample: 30 },
    ]) {
      expect(gateConfigured(settings)).toBe(false);
      const v = evaluateIntelGate(settings, STATS, {
        instrument: "XAUUSD",
        direction: "long",
        session: "london",
        volatilityIndex: 1,
      });
      expect(v.allowed).toBe(true);
      expect(v.reason).toBe("gate_disabled");
    }
  });

  it("[INVARIANT] refuses when there is no statistic at all, rather than passing", () => {
    const v = evaluateIntelGate({ enabled: true, minWinPct: 50, minSample: 30 }, [], {
      instrument: "XAUUSD",
      direction: "long",
      session: "london",
      volatilityIndex: 1,
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("intelligence_gate_sample_insufficient");
    expect(v.winPct).toBeNull();
  });

  it("[INVARIANT] refuses a thin sample even when the rate itself would pass", () => {
    const v = evaluateIntelGate({ enabled: true, minWinPct: 50, minSample: 500 }, STATS, {
      instrument: "XAUUSD",
      direction: "long",
      session: "london",
      volatilityIndex: 1,
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("intelligence_gate_sample_insufficient");
    expect(v.filledN).toBe(200);
  });

  it("[INVARIANT] passes a measured rate at or above the threshold and reports the numbers", () => {
    const v = evaluateIntelGate({ enabled: true, minWinPct: 60, minSample: 30 }, STATS, {
      instrument: "XAUUSD",
      direction: "long",
      session: "london",
      volatilityIndex: 1,
    });
    expect(v).toMatchObject({ allowed: true, reason: "gate_passed", winPct: 62, filledN: 200 });
  });

  it("[INVARIANT] refuses a measured rate below the threshold", () => {
    const v = evaluateIntelGate({ enabled: true, minWinPct: 70, minSample: 30 }, STATS, {
      instrument: "XAUUSD",
      direction: "long",
      session: "london",
      volatilityIndex: 1,
    });
    expect(v).toMatchObject({ allowed: false, reason: "intelligence_gate_below_threshold" });
  });
});

interface Overrides {
  settings?: Record<string, unknown>;
  stats?: unknown[];
}

function fake(overrides: Overrides = {}) {
  const settings = {
    user_id: "user-1",
    instruments: ["XAUUSD"],
    sessions: ["london"],
    alert_min_grade: "B",
    daily_setup_cap: 0,
    execution_config_version: 7,
    auto_intel_gate_enabled: false,
    auto_intel_min_win_pct: null,
    auto_intel_min_sample: 30,
    ...(overrides.settings ?? {}),
  };
  return createFakeSupabase((call: FakeCall) => {
    if (call.table === "execution_controls")
      return { data: [{ demo_auto_enabled: true, live_auto_enabled: false }], error: null };
    if (call.table === "connected_trading_accounts")
      return {
        data: [{ id: "acc-1", user_id: "user-1", mode: "demo_auto", broker_account_type: "demo" }],
        error: null,
      };
    // Armed symbols always have a published broker contract specification in
    // production; without a tick size the enqueue path refuses up front.
    if (call.table === "broker_symbol_specs") return { data: [{ tick_size: 0.01 }], error: null };
    if (call.table === "scanner_settings") return { data: [settings], error: null };
    if (call.table === "regime_stats") return { data: overrides.stats ?? STATS, error: null };
    return { data: [], error: null };
  });
}

const SIGNAL = {
  id: "sig-1",
  instrument: "XAUUSD",
  grade: "A",
  session: "london",
  detectedAt: new Date(NOW).toISOString(),
  direction: "long",
  volatilityIndex: 1,
};

const decisionRows = (calls: FakeCall[]) =>
  calls
    .filter((c) => c.table === "execution_enqueue_decisions")
    .flatMap((c) => c.payload as unknown as Record<string, unknown>[]);

describe("enqueueDirectDeliveries with the gate", () => {
  it("[INVARIANT] an off gate changes nothing and the decision is recorded", async () => {
    const f = fake();
    const out = await enqueueDirectDeliveries(f.client as SupabaseClient, SIGNAL, NOW);
    expect(out.enqueued).toBe(1);
    expect(decisionRows(f.calls)[0]).toMatchObject({ decision: "enqueued", enqueued: 1 });
  });

  it("[INVARIANT] a configured gate below threshold refuses and logs the numbers", async () => {
    const f = fake({
      settings: {
        auto_intel_gate_enabled: true,
        auto_intel_min_win_pct: 80,
        auto_intel_min_sample: 30,
      },
    });
    const out = await enqueueDirectDeliveries(f.client as SupabaseClient, SIGNAL, NOW);
    expect(out).toMatchObject({ enqueued: 0, filtered: 1, reason: "filtered_by_user_rules" });
    // The gate refusing must leave NO delivery behind. Reading the owner's current
    // order occupancy from the same table is a read, so the invariant is written
    // against writes specifically.
    expect(f.calls.some((c) => c.table === "execution_deliveries" && c.op !== "select")).toBe(
      false,
    );
    const row = decisionRows(f.calls)[0] as Record<string, unknown>;
    expect(row["decision"]).toBe("intelligence_gate_below_threshold");
    expect(String(row["detail"])).toContain("62%");
  });

  it("[INVARIANT] unreadable statistics refuse rather than pass the gate", async () => {
    const f = fake({
      settings: {
        auto_intel_gate_enabled: true,
        auto_intel_min_win_pct: 50,
        auto_intel_min_sample: 30,
      },
      stats: [],
    });
    const out = await enqueueDirectDeliveries(f.client as SupabaseClient, SIGNAL, NOW);
    expect(out.enqueued).toBe(0);
    expect(decisionRows(f.calls)[0]).toMatchObject({
      decision: "intelligence_gate_sample_insufficient",
    });
  });

  it("[INVARIANT] system-wide refusals are logged too, so an empty ledger is never ambiguous", async () => {
    const f = createFakeSupabase((call: FakeCall) => {
      if (call.table === "execution_controls")
        return { data: [{ demo_auto_enabled: false, live_auto_enabled: false }], error: null };
      return { data: [], error: null };
    });
    const out = await enqueueDirectDeliveries(f.client as SupabaseClient, SIGNAL, NOW);
    expect(out.reason).toBe("automatic_execution_disabled");
    expect(decisionRows(f.calls)[0]).toMatchObject({
      decision: "automatic_execution_disabled",
      user_id: null,
    });
  });
});
