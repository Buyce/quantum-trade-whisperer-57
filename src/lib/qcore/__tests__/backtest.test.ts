import { describe, expect, it } from "vitest";
import { backtestQCore } from "../backtest";

const input = {
  direction: "long" as const,
  trend: 90,
  orderBlock: 80,
  momentum: 75,
  volatilityExpansion: 70,
  rr: 2,
  maxR: 3,
  regimeWinRate: null,
  regimeActive: false,
  executionQuality: null,
};

describe("Q-Core deterministic backtest", () => {
  it("orders observations chronologically and computes R-path drawdown", () => {
    const result = backtestQCore([
      {
        id: "b",
        detectedAt: "2026-01-02T00:00:00Z",
        instrument: "XAUUSD",
        input,
        realizedR: -1,
        filled: true,
      },
      {
        id: "a",
        detectedAt: "2026-01-01T00:00:00Z",
        instrument: "XAUUSD",
        input,
        realizedR: 2,
        filled: true,
      },
      {
        id: "c",
        detectedAt: "2026-01-03T00:00:00Z",
        instrument: "XAUUSD",
        input,
        realizedR: -0.5,
        filled: true,
      },
    ]);
    expect(result.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(result.metrics.cumulativeR).toBe(0.5);
    expect(result.metrics.maxDrawdownR).toBe(1.5);
    expect(result.metrics.winRate).toBeCloseTo(1 / 3, 4);
  });

  it("does not count a never-filled opportunity as a losing trade", () => {
    const result = backtestQCore([
      {
        id: "filled-win",
        detectedAt: "2026-01-01T00:00:00Z",
        instrument: "XAUUSD",
        input,
        realizedR: 1,
        filled: true,
      },
      {
        id: "never-filled",
        detectedAt: "2026-01-02T00:00:00Z",
        instrument: "XAUUSD",
        input,
        realizedR: 0,
        filled: false,
      },
    ]);
    expect(result.metrics.meanR).toBe(0.5);
    expect(result.metrics.winRate).toBe(1);
    expect(result.metrics.filledN).toBe(1);
  });

  it("never invents unresolved outcomes", () => {
    const result = backtestQCore([
      {
        id: "a",
        detectedAt: "2026-01-01T00:00:00Z",
        instrument: "BTCUSD",
        input,
        realizedR: null,
        filled: null,
      },
    ]);
    expect(result.metrics.resolvedN).toBe(0);
    expect(result.metrics.meanR).toBeNull();
    expect(result.metrics.winRate).toBeNull();
  });
});
