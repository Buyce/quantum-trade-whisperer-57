import { describe, expect, it } from "vitest";
import { walkForwardQCore } from "../walk-forward";

const input = {
  direction: "long" as const,
  trend: 80,
  orderBlock: 75,
  momentum: 70,
  volatilityExpansion: 65,
  rr: 2,
  maxR: 2.5,
  regimeWinRate: null,
  regimeActive: false,
  executionQuality: null,
};

describe("Q-Core walk-forward", () => {
  it("keeps test folds strictly later than their training period", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      detectedAt: `2026-01-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
      instrument: "XAUUSD",
      input,
      realizedR: i % 2 === 0 ? 1 : -1,
      filled: true,
    }));
    const result = walkForwardQCore(rows, { minTrainDays: 4, testDays: 2 });
    expect(result.folds).toHaveLength(2);
    for (const fold of result.folds) expect(fold.testStart > fold.trainEnd).toBe(true);
    expect(result.outOfSampleN).toBe(4);
  });

  it("fails closed when there is no unseen period", () => {
    const result = walkForwardQCore([], { minTrainDays: 4, testDays: 2 });
    expect(result.folds).toHaveLength(0);
    expect(result.blockers.length).toBeGreaterThan(0);
  });
});
