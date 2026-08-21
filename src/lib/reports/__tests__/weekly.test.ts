import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  HIGH_GRADES,
  LOW_GRADES,
  isoWeekKey,
  median,
  normalTwoSidedP,
  tierStats,
  twoProportionZTest,
  type ShadowRow,
} from "../weekly";

const SEED = 20_260_821;

function shadow(over: Partial<ShadowRow> = {}): ShadowRow {
  return {
    grade: "A",
    status: "resolved",
    resolved_outcome: "win",
    realized_r: 2,
    filled_at: "2026-08-20T09:15:00.000Z",
    miss_distance_atr: null,
    ...over,
  } as ShadowRow;
}

describe("statistics helpers", () => {
  it("[UNIT] the two-sided normal p-value matches known z landmarks", () => {
    expect(normalTwoSidedP(0)).toBeCloseTo(1, 6);
    expect(normalTwoSidedP(1.959964)).toBeCloseTo(0.05, 4);
    expect(normalTwoSidedP(2.575829)).toBeCloseTo(0.01, 4);
  });

  it("[UNIT] identical proportions give z = 0 and p = 1", () => {
    const r = twoProportionZTest(20, 40, 30, 60);
    expect(r.z).toBeCloseTo(0, 12);
    expect(r.pValue).toBeCloseTo(1, 6);
  });

  it("[UNIT] a large, clean difference is significant at the 5% level", () => {
    const r = twoProportionZTest(80, 100, 40, 100);
    expect(r.z!).toBeGreaterThan(1.96);
    expect(r.pValue!).toBeLessThan(0.05);
  });

  it("[INVARIANT] empty or degenerate samples return nulls, never a fabricated z", () => {
    expect(twoProportionZTest(0, 0, 5, 10)).toEqual({ z: null, pValue: null });
    expect(twoProportionZTest(5, 10, 0, 0)).toEqual({ z: null, pValue: null });
    // Pooled proportion of exactly 0 (or 1) has zero variance.
    expect(twoProportionZTest(0, 10, 0, 10)).toEqual({ z: null, pValue: null });
    expect(twoProportionZTest(10, 10, 10, 10)).toEqual({ z: null, pValue: null });
  });

  it("[INVARIANT] p-values stay in [0,1] and z stays finite across arbitrary counts", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 0, max: 500 }),
        (sa, na, sb, nb) => {
          const r = twoProportionZTest(Math.min(sa, na), na, Math.min(sb, nb), nb);
          if (r.z === null) {
            expect(r.pValue).toBeNull();
            return true;
          }
          expect(Number.isFinite(r.z)).toBe(true);
          expect(r.pValue!).toBeGreaterThanOrEqual(0);
          expect(r.pValue!).toBeLessThanOrEqual(1);
          return true;
        },
      ),
      { seed: SEED, numRuns: 400 },
    );
  });

  it("[UNIT] median handles empty, odd and even samples", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("[UNIT] isoWeekKey is ISO-8601 and stable across the year boundary", () => {
    // 2026-01-01 is a Thursday → ISO week 1 of 2026.
    expect(isoWeekKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-W01");
    expect(isoWeekKey(new Date("2026-08-20T00:00:00Z"))).toBe("2026-W34");
    // Monday and Sunday of the same ISO week share a key (the send latch).
    expect(isoWeekKey(new Date("2026-08-17T00:00:00Z"))).toBe(
      isoWeekKey(new Date("2026-08-23T23:59:00Z")),
    );
  });
});

describe("tierStats", () => {
  it("[UNIT] the grade partition is exactly A/A+ against B/C", () => {
    expect(HIGH_GRADES).toEqual(["A+", "A"]);
    expect(LOW_GRADES).toEqual(["B", "C"]);
  });

  it("[UNIT] fill rate is over resolved rows and win rate is over FILLED rows", () => {
    const rows: ShadowRow[] = [
      shadow({ grade: "A", resolved_outcome: "win", realized_r: 2 }),
      shadow({ grade: "A+", resolved_outcome: "loss", realized_r: -1 }),
      shadow({
        grade: "A",
        resolved_outcome: "never_filled",
        realized_r: 0,
        filled_at: null,
        miss_distance_atr: 0.5,
      }),
      shadow({ grade: "A", status: "open", resolved_outcome: null }),
      shadow({ grade: "B", resolved_outcome: "win", realized_r: 1 }),
    ];
    const high = tierStats(rows, "high");
    expect(high.enrolled).toBe(4);
    expect(high.resolved).toBe(3);
    expect(high.filled).toBe(2);
    expect(high.fillRate).toBeCloseTo(2 / 3, 12);
    expect(high.winRate).toBeCloseTo(0.5, 12);
    expect(high.meanR).toBeCloseTo(0.5, 12);
    expect(high.expectancyR).toBeCloseTo(0.5 * 2 - 0.5 * 1, 12);
    expect(high.medianMissAtr).toBeCloseTo(0.5, 12);
    expect(tierStats(rows, "low").enrolled).toBe(1);
  });

  it("[INVARIANT] an empty cohort reports nulls rather than zeros that look like results", () => {
    const empty = tierStats([], "high");
    expect(empty.resolved).toBe(0);
    expect(empty.fillRate).toBeNull();
    expect(empty.winRate).toBeNull();
    expect(empty.meanR).toBeNull();
    expect(empty.expectancyR).toBeNull();
    expect(empty.medianMissAtr).toBeNull();
  });
});
