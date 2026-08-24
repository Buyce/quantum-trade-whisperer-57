import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  EMPTY_EXPECTANCY,
  computeExpectancy,
  generateInsights,
  samplesFromBrokerEvidence,
  type RSample,
} from "../performance";
import type { Grade } from "../db-types";
import { collectCompleteEvidencePages } from "../performance-evidence.server";

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

  it("[INVARIANT] signed R, not a contradictory journal label, determines win/loss", () => {
    const e = computeExpectancy([sample("win", -1), sample("loss", 2), sample("win", 0)]);
    expect(e).toMatchObject({ wins: 1, losses: 1, breakeven: 1 });
    expect(e.winRate).toBeCloseTo(1 / 3, 12);
    expect(e.lossRate).toBeCloseTo(1 / 3, 12);
    expect(e.avgWinR).toBe(2);
    expect(e.avgLossR).toBe(1);
    expect(e.expectancyR).toBeCloseTo(1 / 3, 12);
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

describe("generateInsights is non-prescriptive at small n", () => {
  const PRESCRIPTIVE =
    /consider excluding|excluding it|raising your minimum grade|strongest tier|highest-yield|net drag|you should|avoid trading|prefer|focus on|stop trading/i;

  it("[INVARIANT] n = 3 produces strictly descriptive/cautionary output", () => {
    const samples = [sample("win", 2), sample("loss", -1), sample("win", 1.5)];
    const out = generateInsights(samples, "EURUSD").join(" ");
    expect(out).not.toMatch(PRESCRIPTIVE);
    expect(out).toMatch(/below the .* floor|not an estimate of what to expect|no conclusion/i);
    expect(out).toMatch(/3 closed setups/);
  });

  it("[INVARIANT] no sample size emits prescriptive optimisation language", () => {
    const many: RSample[] = [];
    for (let i = 0; i < 120; i++) {
      many.push(sample(i % 3 === 0 ? "win" : "loss", i % 3 === 0 ? 2 : -1, i % 2 ? "A" : "C"));
    }
    const out = generateInsights(many, "All setups").join(" ");
    expect(out).not.toMatch(PRESCRIPTIVE);
    expect(out).toMatch(/descriptive/i);
  });

  it("[UNIT] zero closed results says so instead of inventing a number", () => {
    expect(generateInsights([], "EURUSD").join(" ")).toMatch(/no closed results/i);
  });
});

describe("broker Performance evidence separation", () => {
  const evidence = [
    {
      key: "customer-0",
      source: "customer" as const,
      instrument: "EURUSD",
      grade: "A" as const,
      detectedAt: "2026-08-20T09:00:00.000Z",
      hour: 9,
      dayOfWeek: 4,
      session: "london",
      rVsPlan: 2,
      rVsActualRisk: 1.25,
    },
    {
      key: "customer-1",
      source: "customer" as const,
      instrument: "XAUUSD",
      grade: "Unknown" as const,
      detectedAt: "2026-08-20T10:00:00.000Z",
      hour: 10,
      dayOfWeek: 4,
      session: "london",
      rVsPlan: -1,
      rVsActualRisk: null,
    },
  ];

  it("[INVARIANT] selects r_vs_plan without averaging it with actual-risk R", () => {
    const samples = samplesFromBrokerEvidence(evidence, "plan");
    expect(samples.map((row) => row.r)).toEqual([2, -1]);
  });

  it("[INVARIANT] selects only available r_vs_actual_risk rows and never falls back to plan", () => {
    const samples = samplesFromBrokerEvidence(evidence, "actual_risk");
    expect(samples).toHaveLength(1);
    expect(samples[0]?.r).toBe(1.25);
  });

  it("[INVARIANT] Performance reads past the first 1,000 closed broker rows", async () => {
    const fetchPage = async (from: number) =>
      from === 0 ? Array.from({ length: 1_000 }, (_, i) => i) : [1_000];
    await expect(collectCompleteEvidencePages(fetchPage)).resolves.toHaveLength(1_001);
  });

  it("[INVARIANT] Performance refuses a bounded but incomplete population", async () => {
    const fetchPage = async () => Array.from({ length: 2 }, (_, i) => i);
    await expect(collectCompleteEvidencePages(fetchPage, 2, 2)).rejects.toThrow(
      /refusing incomplete metrics/,
    );
  });
});
