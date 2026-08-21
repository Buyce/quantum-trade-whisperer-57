import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { EMPTY_EXPECTANCY, computeExpectancy, type RSample } from "../performance";
import type { Grade } from "../db-types";

const SEED = 20_260_821;

function sample(outcome: RSample["outcome"], r: number, grade: Grade = "A"): RSample {
  return {
    key: `${outcome}-${r}`,
    instrument: "EURUSD",
    grade,
    outcome,
    r,
    detectedAt: "2026-08-20T09:00:00.000Z",
    hour: 9,
    dayOfWeek: 4,
    session: "london",
  };
}

describe("computeExpectancy", () => {
  it("[INVARIANT] no samples returns the explicit zeroed record — never invented performance", () => {
    expect(computeExpectancy([])).toEqual(EMPTY_EXPECTANCY);
  });

  it("[UNIT] expectancy = winRate x avgWin - lossRate x avgLoss", () => {
    const e = computeExpectancy([
      sample("win", 2),
      sample("win", 3),
      sample("loss", -1),
      sample("breakeven", 0),
    ]);
    expect(e.count).toBe(4);
    expect(e.wins).toBe(2);
    expect(e.losses).toBe(1);
    expect(e.breakeven).toBe(1);
    expect(e.winRate).toBeCloseTo(0.5, 12);
    expect(e.lossRate).toBeCloseTo(0.25, 12);
    expect(e.avgWinR).toBeCloseTo(2.5, 12);
    expect(e.avgLossR).toBeCloseTo(1, 12);
    expect(e.expectancyR).toBeCloseTo(0.5 * 2.5 - 0.25 * 1, 12);
    expect(e.totalR).toBeCloseTo(4, 12);
  });

  it("[UNIT] avgLossR is reported as a positive magnitude", () => {
    const e = computeExpectancy([sample("loss", -1), sample("loss", -2)]);
    expect(e.avgLossR).toBeCloseTo(1.5, 12);
    expect(e.expectancyR).toBeCloseTo(-1.5, 12);
  });

  it("[UNIT] breakeven rows count toward the sample size but not the rates", () => {
    const e = computeExpectancy([sample("breakeven", 0), sample("breakeven", 0)]);
    expect(e.count).toBe(2);
    expect(e.winRate).toBe(0);
    expect(e.lossRate).toBe(0);
    expect(e.expectancyR).toBe(0);
  });

  it("[INVARIANT] rates stay in [0,1], every field is finite, and totalR is the plain sum", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom<RSample["outcome"]>("win", "loss", "breakeven"),
            fc.double({ min: -20, max: 20, noNaN: true }),
          ),
          { minLength: 1, maxLength: 60 },
        ),
        (rows) => {
          const samples = rows.map(([outcome, r]) => sample(outcome, r));
          const e = computeExpectancy(samples);
          for (const v of Object.values(e)) expect(Number.isFinite(v)).toBe(true);
          expect(e.winRate).toBeGreaterThanOrEqual(0);
          expect(e.winRate).toBeLessThanOrEqual(1);
          expect(e.lossRate).toBeGreaterThanOrEqual(0);
          expect(e.lossRate).toBeLessThanOrEqual(1);
          expect(e.winRate + e.lossRate).toBeLessThanOrEqual(1 + 1e-9);
          expect(e.wins + e.losses + e.breakeven).toBe(e.count);
          expect(e.totalR).toBeCloseTo(
            samples.reduce((a, s) => a + s.r, 0),
            6,
          );
          return true;
        },
      ),
      { seed: SEED, numRuns: 300 },
    );
  });
});
