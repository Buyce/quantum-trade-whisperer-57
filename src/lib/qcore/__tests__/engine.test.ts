import { describe, expect, it } from "vitest";
import { evaluateQCore } from "../engine";

const strong = {
  direction: "long" as const,
  trend: 90,
  orderBlock: 85,
  momentum: 78,
  volatilityExpansion: 72,
  rr: 2.5,
  maxR: 3,
  regimeWinRate: 0.64,
  regimeActive: true,
  executionQuality: 90,
};

describe("Q-Core v1 shadow ensemble", () => {
  it("supports a strong long hypothesis without becoming execution authority", () => {
    const q = evaluateQCore(strong);
    expect(q.mode).toBe("shadow");
    expect(q.executionEligible).toBe(false);
    expect(q.state).toBe("long");
    expect(q.directionalScore).toBeGreaterThan(0);
    expect(q.stateWeights.long).toBeGreaterThan(q.stateWeights.short);
  });

  it("mirrors directional evidence for a short hypothesis", () => {
    const q = evaluateQCore({ ...strong, direction: "short" });
    expect(q.state).toBe("short");
    expect(q.directionalScore).toBeLessThan(0);
    expect(q.stateWeights.short).toBeGreaterThan(q.stateWeights.long);
  });

  it("does not fabricate regime evidence when the reporting gate is inactive", () => {
    const q = evaluateQCore({ ...strong, regimeActive: false, regimeWinRate: 0.99 });
    const regime = q.factors.find((f) => f.name === "regime");
    expect(regime?.measured).toBe(false);
    expect(regime?.weight).toBe(0);
    expect(q.reasons).toContain("regime_reporting_gate=inactive");
  });

  it("does not let execution quality create direction", () => {
    const base = {
      direction: "long" as const,
      trend: 50,
      orderBlock: 50,
      momentum: 50,
      volatilityExpansion: 50,
      rr: 1,
      maxR: 1,
      regimeWinRate: null,
      regimeActive: false,
    };
    const poor = evaluateQCore({ ...base, executionQuality: 0 });
    const perfect = evaluateQCore({ ...base, executionQuality: 100 });
    expect(poor.directionalScore).toBe(0);
    expect(perfect.directionalScore).toBe(0);
    expect(poor.state).toBe("neutral");
    expect(perfect.state).toBe("neutral");
  });

  it("keeps state weights bounded and approximately normalized", () => {
    const q = evaluateQCore(strong);
    const sum = q.stateWeights.long + q.stateWeights.neutral + q.stateWeights.short;
    expect(sum).toBeCloseTo(1, 3);
    for (const v of Object.values(q.stateWeights)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("treats missing payoff as missing evidence rather than a default", () => {
    const q = evaluateQCore({ ...strong, rr: null, maxR: null });
    const payoff = q.factors.find((f) => f.name === "payoff");
    expect(payoff?.measured).toBe(false);
    expect(q.evidenceCoverage).toBeLessThan(1);
    expect(q.executionEligible).toBe(false);
  });
});
