/**
 * Stage 2/3 invariants.
 *
 * 1. `buildTradeProfile` must remain byte-identical in behaviour to
 *    `evaluateSetup`: the refactor may not change what publishes.
 * 2. Every evaluation reports exactly one terminal stage and a complete gate
 *    list, with no gate silently missing.
 * 3. A rejected candidate never carries invented geometry.
 */
import { describe, expect, it } from "vitest";
import { buildTradeProfile, evaluateSetup, type BuildProfileInput } from "../profile";
import type { Candle } from "../types";

const GATES = 8;

function series(count: number, shape: (i: number) => Partial<Candle>): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const base = 1.1 + i * 0.0005;
    return {
      time: new Date(Date.UTC(2026, 0, 1, 0, i * 15)).toISOString(),
      open: base,
      high: base + 0.0008,
      low: base - 0.0008,
      close: base + 0.0002,
      volume: 100,
      ...shape(i),
    } as Candle;
  });
}

const flat = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({
    time: new Date(Date.UTC(2026, 0, 1, 0, i * 15)).toISOString(),
    open: 1.1,
    high: 1.1,
    low: 1.1,
    close: 1.1,
    volume: 100,
  })) as Candle[];

const inputs: Record<string, BuildProfileInput> = {
  empty: { instrument: "EURUSD", candles: { H4: [], H1: [], M15: [] } },
  flat: { instrument: "EURUSD", candles: { H4: flat(60), H1: flat(60), M15: flat(60) } },
  trending: {
    instrument: "EURUSD",
    candles: {
      H4: series(60, () => ({})),
      H1: series(60, () => ({})),
      M15: series(80, () => ({})),
    },
    session: "london",
  },
  spiky: {
    instrument: "XAUUSD",
    candles: {
      H4: series(60, (i) => ({ high: 1.1 + i * 0.02 })),
      H1: series(60, (i) => ({ low: 1.1 - i * 0.01 })),
      M15: series(80, (i) => (i % 7 === 0 ? { low: 1.05, high: 1.2 } : {})),
    },
    session: "overlap",
  },
};

describe("gate-labelled setup evaluation", () => {
  for (const [name, input] of Object.entries(inputs)) {
    it(`[INVARIANT] ${name}: buildTradeProfile agrees with evaluateSetup`, () => {
      const evaluation = evaluateSetup(input);
      const profile = buildTradeProfile(input);
      if (evaluation.stage === "published") {
        expect(profile).toEqual(evaluation.proposedProfile);
        expect(profile).not.toBeNull();
      } else {
        expect(profile).toBeNull();
        expect(evaluation.proposedProfile).toBeNull();
      }
    });

    it(`[INVARIANT] ${name}: every gate reaches a verdict exactly once`, () => {
      const { gates } = evaluateSetup(input);
      expect(gates).toHaveLength(GATES);
      expect(new Set(gates.map((g) => g.gate)).size).toBe(GATES);
      // At most one failing gate: the terminal one.
      expect(gates.filter((g) => g.outcome === "fail").length).toBeLessThanOrEqual(1);
      // Nothing may be evaluated after the terminal failure.
      const failAt = gates.findIndex((g) => g.outcome === "fail");
      if (failAt >= 0) {
        for (const g of gates.slice(failAt + 1)) expect(g.outcome).toBe("not_evaluable");
      }
    });

    it(`[INVARIANT] ${name}: rejected candidates carry no invented targets`, () => {
      const evaluation = evaluateSetup(input);
      if (evaluation.stage === "published") return;
      // Geometry may be partially derived, but a full plan is never fabricated.
      expect(evaluation.proposedProfile).toBeNull();
      if (evaluation.geometry.entryPrice !== null) {
        // If an entry exists, so must the stop it was measured against.
        expect(evaluation.geometry.stopLoss).not.toBeNull();
        expect(evaluation.geometry.riskPrice).not.toBeNull();
      }
    });
  }

  it("[UNIT] an empty M15 series terminates at the candle gate", () => {
    const e = evaluateSetup(inputs["empty"]!);
    expect(e.stage).toBe("no_candles");
    expect(e.gates[0]).toMatchObject({ gate: "candles_present", outcome: "fail" });
    expect(e.direction).toBeNull();
    expect(e.geometry.entryPrice).toBeNull();
  });

  it("[UNIT] a flat market terminates on direction, not on grading", () => {
    const e = evaluateSetup(inputs["flat"]!);
    expect(e.stage).toBe("m15_neutral");
    expect(e.features["m15Bias"]).toBe("neutral");
  });
});
