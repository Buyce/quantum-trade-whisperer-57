/**
 * Agent outcome-write behaviour: one-sided prices are rejected before any
 * mutation, and a legacy row with no snapshot direction can never silently
 * become long.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeCall, type FakeSupabase } from "@/test/fakes/supabase";

let fake: FakeSupabase;

vi.mock("../supabase", () => ({
  supabaseForUser: () => fake.client,
}));

const { default: updateTradeOutcome } = await import("../tools/update-trade-outcome");

const TRADE_ID = "11111111-1111-4111-8111-111111111111";
const SIGNAL_ID = "22222222-2222-4222-8222-222222222222";

const ctx = {
  isAuthenticated: () => true,
  getClientId: () => "test-client",
  getToken: () => "token",
} as never;

interface Options {
  plannedDirection: "long" | "short" | null;
  signalDirection?: "long" | "short" | null;
  signalExists?: boolean;
}

function setup({ plannedDirection, signalDirection = null, signalExists = true }: Options) {
  fake = createFakeSupabase((call: FakeCall) => {
    if (call.table === "executed_trades" && call.op === "select") {
      return {
        data: [
          {
            id: TRADE_ID,
            signal_id: SIGNAL_ID,
            outcome: "open",
            planned_entry: 100,
            planned_stop: 98,
            planned_direction: plannedDirection,
            r_vs_plan: null,
            r_vs_actual_risk: null,
            r_availability: null,
            stop_provenance: null,
          },
        ],
        error: null,
      };
    }
    if (call.table === "scanned_signals") {
      return { data: signalExists ? [{ direction: signalDirection }] : [], error: null };
    }
    if (call.table === "executed_trades" && call.op === "update") {
      return { data: [{ id: TRADE_ID, ...call.payload }], error: null };
    }
    return { data: [], error: null };
  });
}

const run = (input: Record<string, unknown>) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (updateTradeOutcome as any).handler(input, ctx) as Promise<any>;

const updates = () => fake.calls.filter((c) => c.op === "update");

describe("update_trade_outcome price pairing", () => {
  beforeEach(() => setup({ plannedDirection: "long" }));

  it("[INVARIANT] entry-only input is rejected and nothing is written", async () => {
    const res = await run({ trade_id: TRADE_ID, outcome: "win", actual_entry_price: 101 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("actual_exit_price");
    expect(updates()).toEqual([]);
  });

  it("[INVARIANT] exit-only input is rejected and nothing is written", async () => {
    const res = await run({ trade_id: TRADE_ID, outcome: "win", actual_exit_price: 105 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("actual_entry_price");
    expect(updates()).toEqual([]);
  });

  it("[UNIT] both prices compute R and record self_reported", async () => {
    const res = await run({
      trade_id: TRADE_ID,
      outcome: "win",
      actual_entry_price: 101,
      actual_exit_price: 105,
    });
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent.verification_level).toBe("self_reported");
    expect(res.structuredContent.r_vs_plan).toBe(2);
    expect(updates()).toHaveLength(1);
  });

  it("[UNIT] neither price leaves R unavailable and unverified", async () => {
    const res = await run({ trade_id: TRADE_ID, outcome: "win" });
    expect(res.structuredContent.verification_level).toBe("unverified");
    expect(res.structuredContent.r_vs_plan).toBeNull();
    expect(res.structuredContent.r_availability).toBe("unavailable_no_prices");
  });
});

describe("update_trade_outcome legacy direction", () => {
  it("[INVARIANT] legacy long row takes the exact direction from its signal", async () => {
    setup({ plannedDirection: null, signalDirection: "long" });
    const res = await run({
      trade_id: TRADE_ID,
      outcome: "win",
      actual_entry_price: 101,
      actual_exit_price: 105,
    });
    expect(res.structuredContent.r_vs_plan).toBe(2);
  });

  it("[INVARIANT] legacy short row is computed as short, not long", async () => {
    setup({ plannedDirection: null, signalDirection: "short" });
    const res = await run({
      trade_id: TRADE_ID,
      outcome: "win",
      actual_entry_price: 105,
      actual_exit_price: 101,
    });
    // gross move = 105 - 101 = +4 for a short; a long fallback would give -2R.
    expect(res.structuredContent.r_vs_plan).toBe(2);
  });

  it("[INVARIANT] missing snapshot and missing signal never becomes long", async () => {
    setup({ plannedDirection: null, signalExists: false });
    const res = await run({
      trade_id: TRADE_ID,
      outcome: "win",
      actual_entry_price: 101,
      actual_exit_price: 105,
    });
    expect(res.structuredContent.r_availability).toBe("unavailable_no_direction");
    expect(res.structuredContent.r_vs_plan).toBeNull();
    expect(res.structuredContent.r_vs_actual_risk).toBeNull();
    expect(res.structuredContent.note).toContain("direction");
  });
});
