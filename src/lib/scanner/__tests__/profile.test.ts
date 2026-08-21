import { describe, expect, it } from "vitest";
import { buildBreakdown, buildTradeProfile, scoreConfidence, structureKeyOf } from "../profile";
import { CONFIDENCE_WEIGHTS, type PillarScores } from "../types";
import { rampSeries } from "@/test/fixtures/provenance";

function pillars(overrides: Partial<PillarScores> = {}): PillarScores {
  return {
    trend: 80,
    orderBlock: 80,
    momentum: 80,
    volatilityExpansion: 80,
    passed: 4,
    notes: ["synthetic"],
    ...overrides,
  } as PillarScores;
}

describe("scoreConfidence — V1 characterization", () => {
  it("[V1_CHARACTERIZATION] symmetry is reported in the breakdown but does NOT move the score", () => {
    // Pattern symmetry is displayed as a confidence component while the score
    // itself is pillar-weighted only. CHARACTERISATION.md #6.
    const a = scoreConfidence({ pillars: pillars(), rrRatio: 3, symmetry: 0 });
    const b = scoreConfidence({ pillars: pillars(), rrRatio: 3, symmetry: 100 });
    expect(a.score).toBe(b.score);
    expect(a.symmetry).toBe(0);
    expect(b.symmetry).toBe(100);
  });

  it("[V1_CHARACTERIZATION] the R:R multiplier floor is 0.7 — a terrible payoff still keeps 70% of the score", () => {
    const thin = scoreConfidence({ pillars: pillars(), rrRatio: 0.1, symmetry: 50 });
    const weighted =
      80 *
      (CONFIDENCE_WEIGHTS.trend +
        CONFIDENCE_WEIGHTS.orderBlock +
        CONFIDENCE_WEIGHTS.momentum +
        CONFIDENCE_WEIGHTS.volatilityExpansion);
    expect(thin.score).toBeCloseTo(Number((weighted * 0.7).toFixed(1)), 6);
  });

  it("[UNIT] the R:R multiplier is neutral at 1:2 and above", () => {
    const rr2 = scoreConfidence({ pillars: pillars(), rrRatio: 2, symmetry: 50 });
    const rr5 = scoreConfidence({ pillars: pillars(), rrRatio: 5, symmetry: 50 });
    expect(rr2.score).toBe(rr5.score);
  });

  it("[UNIT] confidence weights sum to 1", () => {
    const sum =
      CONFIDENCE_WEIGHTS.trend +
      CONFIDENCE_WEIGHTS.orderBlock +
      CONFIDENCE_WEIGHTS.momentum +
      CONFIDENCE_WEIGHTS.volatilityExpansion;
    expect(sum).toBeCloseTo(1, 12);
  });

  it("[INVARIANT] every reported confidence component stays inside [0,100] and is finite", () => {
    const cases = [
      {
        pillars: pillars({ trend: 0, orderBlock: 0, momentum: 0, volatilityExpansion: 0 }),
        rrRatio: 0,
        symmetry: -50,
      },
      {
        pillars: pillars({ trend: 100, orderBlock: 100, momentum: 100, volatilityExpansion: 100 }),
        rrRatio: 99,
        symmetry: 500,
      },
    ];
    for (const c of cases) {
      const out = scoreConfidence(c);
      for (const v of [out.alignment, out.rr, out.symmetry, out.volatility, out.score]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("buildTradeProfile — No-Trade default", () => {
  it("[INVARIANT] empty candle arrays publish nothing", () => {
    expect(
      buildTradeProfile({ instrument: "EURUSD", candles: { H4: [], H1: [], M15: [] } }),
    ).toBeNull();
  });

  it("[INVARIANT] a flat market publishes nothing (M15 bias neutral)", () => {
    const flat = rampSeries("2026-08-20T00:00:00.000Z", 260, 1.1, 0);
    expect(
      buildTradeProfile({ instrument: "EURUSD", candles: { H4: flat, H1: flat, M15: flat } }),
    ).toBeNull();
  });

  it("[INVARIANT] NaN-poisoned candles never publish a signal", () => {
    const poisoned = rampSeries("2026-08-20T00:00:00.000Z", 260, 1.1, 0.001).map((c, i) =>
      i % 3 === 0 ? { ...c, close: Number.NaN, high: Number.NaN } : c,
    );
    const profile = buildTradeProfile({
      instrument: "EURUSD",
      candles: { H4: poisoned, H1: poisoned, M15: poisoned },
    });
    expect(profile).toBeNull();
  });

  it("[INVARIANT] when a profile IS produced, every published number is finite and correctly sided", () => {
    // A clean staircase uptrend with a shallow pullback is the only shape that
    // can pass every gate; if V1 declines to publish it, the No-Trade default is
    // still a valid outcome and nothing is asserted about invented values.
    const rising = rampSeries("2026-08-20T00:00:00.000Z", 300, 1.1, 0.0008);
    const pullback = [
      ...rising,
      ...rampSeries("2026-08-23T00:00:00.000Z", 8, rising[rising.length - 1]!.close, -0.0004),
    ];
    const profile = buildTradeProfile({
      instrument: "EURUSD",
      candles: { H4: rising, H1: rising, M15: pullback },
    });
    if (!profile) return;
    const nums = [
      profile.entryPrice,
      profile.stopLoss,
      profile.tp1,
      profile.tp2,
      profile.atr,
      profile.rrRatio,
      profile.confidence.score,
    ];
    for (const n of nums) expect(Number.isFinite(n)).toBe(true);
    expect(profile.rrRatio).toBeGreaterThan(0);
    if (profile.direction === "long") {
      expect(profile.stopLoss).toBeLessThan(profile.entryPrice);
      expect(profile.tp1).toBeGreaterThan(profile.entryPrice);
    } else {
      expect(profile.stopLoss).toBeGreaterThan(profile.entryPrice);
      expect(profile.tp1).toBeLessThan(profile.entryPrice);
    }
  });
});

describe("structureKeyOf + buildBreakdown", () => {
  it("[UNIT] the dedup key is stable for the same structure and differs across direction", () => {
    const base = {
      instrument: "EURUSD",
      direction: "long" as const,
      aTime: "2026-08-20T00:00:00.000Z",
      bTime: "2026-08-20T06:00:00.000Z",
      stopLoss: 1.095,
    };
    expect(structureKeyOf(base)).toBe(structureKeyOf({ ...base }));
    expect(structureKeyOf({ ...base, direction: "short" })).not.toBe(structureKeyOf(base));
  });

  it("[UNIT] the qualitative breakdown names the grade and never emits NaN", () => {
    const text = buildBreakdown({
      grade: "A+",
      direction: "long",
      satisfied: ["one"],
      violated: [],
      symmetry: 88.4,
      alignment: 92,
      rrRatio: 3,
      atr: 0.002,
      pillars: pillars(),
    });
    expect(text).toContain("A+ Grade");
    expect(text).not.toContain("NaN");
  });
});
