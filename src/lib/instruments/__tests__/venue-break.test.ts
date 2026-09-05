/**
 * [INVARIANT] A venue's own daily close is not missing data — but only for the
 * asset classes that actually have one. FX runs continuously Sunday to Friday, so
 * a weekday hole there stays fatal.
 */
import { describe, expect, it } from "vitest";

import { DAILY_BREAK_TOLERANCE_MINUTES, validateSeries } from "../series";
import type { Candle } from "@/lib/scanner/types";

/** Hourly candles from `startIso`, skipping `breakHours` after `beforeIndex`. */
function hourly(count: number, startMs: number, gapAt: number, gapHours: number): Candle[] {
  const out: Candle[] = [];
  let t = startMs;
  for (let i = 0; i < count; i++) {
    if (i === gapAt) t += gapHours * 3_600_000;
    out.push({
      time: new Date(t).toISOString(),
      open: 100,
      high: 101,
      low: 99,
      close: 100,
    } as Candle);
    t += 3_600_000;
  }
  return out;
}

// A Wednesday, so nothing straddles a weekend.
const START = Date.UTC(2026, 8, 2, 0, 0, 0);

describe("venue daily break", () => {
  it("[UNIT] a two-hour index close is reported but not fatal", () => {
    const candles = hourly(30, START, 20, 2);
    const report = validateSeries({
      timeframe: "H1",
      candles,
      required: 20,
      now: new Date(new Date(candles.at(-1)!.time).getTime() + 30 * 60_000),
      breakToleranceMinutes: DAILY_BREAK_TOLERANCE_MINUTES["index"] ?? 0,
    });
    expect(report.findings.some((f) => f.problem === "daily_break")).toBe(true);
    expect(report.findings.some((f) => f.problem === "interval_gap")).toBe(false);
    expect(report.missingIntervals).toBe(0);
    expect(report.ok).toBe(true);
  });

  it("[INVARIANT] the same hole in an FX series stays a fatal gap", () => {
    const candles = hourly(30, START, 20, 2);
    const report = validateSeries({
      timeframe: "H1",
      candles,
      required: 20,
      now: new Date(new Date(candles.at(-1)!.time).getTime() + 30 * 60_000),
      breakToleranceMinutes: DAILY_BREAK_TOLERANCE_MINUTES["fx"] ?? 0,
    });
    expect(report.findings.some((f) => f.problem === "interval_gap")).toBe(true);
    expect(report.ok).toBe(false);
  });

  it("[INVARIANT] a gap longer than the venue close is still fatal", () => {
    const candles = hourly(30, START, 20, 9);
    const report = validateSeries({
      timeframe: "H1",
      candles,
      required: 20,
      now: new Date(new Date(candles.at(-1)!.time).getTime() + 30 * 60_000),
      breakToleranceMinutes: DAILY_BREAK_TOLERANCE_MINUTES["index"] ?? 0,
    });
    expect(report.findings.some((f) => f.problem === "interval_gap")).toBe(true);
    expect(report.ok).toBe(false);
  });
});
