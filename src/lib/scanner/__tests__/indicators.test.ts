import { describe, expect, it } from "vitest";
import {
  atr,
  atrMovingAverage,
  clamp,
  detectAbc,
  ema,
  rsi,
  rsiSeries,
  sma,
  swings,
} from "../indicators";
import { m15Series, rampSeries } from "@/test/fixtures/provenance";
import type { Candle } from "../types";

/** Candles whose true range is exactly 1.0 on every bar. */
function unitTrueRange(count: number): Candle[] {
  return m15Series(
    "2026-08-20T00:00:00.000Z",
    Array.from({ length: count }, () => ({ open: 100, high: 100.5, low: 99.5, close: 100 })),
  );
}

describe("indicators — deterministic maths", () => {
  it("[UNIT] sma of a constant series is that constant", () => {
    expect(sma([10, 10, 10, 10, 10], 5)).toBe(10);
  });

  it("[UNIT] sma returns null below the period", () => {
    expect(sma([10, 10], 5)).toBeNull();
  });

  it("[UNIT] ema of a constant series is that constant", () => {
    expect(ema(Array(50).fill(10), 20)).toBeCloseTo(10, 12);
  });

  it("[UNIT] ema returns null below the period", () => {
    expect(ema([1, 2, 3], 20)).toBeNull();
  });

  it("[UNIT] atr of a series with true range 1.0 on every bar is 1.0", () => {
    expect(atr(unitTrueRange(30), 14)).toBeCloseTo(1, 12);
  });

  it("[V1_CHARACTERIZATION] atr returns 0 — not null — when there is not enough data", () => {
    // Observed current behaviour. sma/ema signal "unavailable" with null while
    // atr signals it with 0, a value that is indistinguishable from a real
    // reading of zero volatility. See CHARACTERISATION.md #2.
    expect(atr(unitTrueRange(10), 14)).toBe(0);
    expect(sma([1, 2], 14)).toBeNull();
    expect(ema([1, 2], 14)).toBeNull();
  });

  it("[UNIT] atrMovingAverage returns null before the MA window is warm", () => {
    expect(atrMovingAverage(unitTrueRange(20), 14, 20)).toBeNull();
    expect(atrMovingAverage(unitTrueRange(40), 14, 20)).toBeCloseTo(1, 12);
  });

  it("[UNIT] rsi is 100 on a monotonically rising series and never exceeds 100", () => {
    const rising = rampSeries("2026-08-20T00:00:00.000Z", 40, 1.1, 0.001);
    const value = rsi(rising, 14);
    expect(value).not.toBeNull();
    expect(value!).toBeLessThanOrEqual(100);
    expect(value!).toBeCloseTo(100, 6);
  });

  it("[UNIT] rsi of a perfectly flat series is 50 and every value stays in [0,100]", () => {
    const flat = m15Series(
      "2026-08-20T00:00:00.000Z",
      Array.from({ length: 40 }, () => ({ open: 1.1, high: 1.1, low: 1.1, close: 1.1 })),
    );
    expect(rsi(flat, 14)).toBe(50);
    for (const v of rsiSeries(flat, 14)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("[UNIT] rsiSeries is empty below the warm-up length", () => {
    expect(rsiSeries(unitTrueRange(10), 14)).toEqual([]);
  });

  it("[UNIT] swings finds the fractal high and low of a symmetric peak", () => {
    const candles = m15Series("2026-08-20T00:00:00.000Z", [
      { open: 1, high: 1.1, low: 0.9, close: 1 },
      { open: 1, high: 1.2, low: 0.95, close: 1.1 },
      { open: 1.1, high: 1.5, low: 1.05, close: 1.4 },
      { open: 1.4, high: 1.2, low: 0.96, close: 1 },
      { open: 1, high: 1.1, low: 0.9, close: 0.95 },
    ]);
    expect(swings(candles, 2)).toEqual([{ index: 2, price: 1.5, kind: "high" }]);
  });

  it("[UNIT] clamp bounds both ends", () => {
    expect(clamp(-5, 0, 100)).toBe(0);
    expect(clamp(500, 0, 100)).toBe(100);
    expect(clamp(42, 0, 100)).toBe(42);
  });

  it("[UNIT] detectAbc returns null when there are too few swings", () => {
    expect(detectAbc(unitTrueRange(3), "long")).toBeNull();
  });
});
