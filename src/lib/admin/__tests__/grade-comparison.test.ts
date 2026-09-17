import { describe, expect, it } from "vitest";

import {
  compareGradeLadder,
  compareGradePair,
  MIN_CLUSTERS_TOTAL,
  type GradeObservation,
} from "@/lib/admin/grade-comparison";

/** n setups of one grade in one stratum, alternating around `mean`. */
function block(
  grade: string,
  stratum: string,
  n: number,
  mean: number,
  spread = 0.2,
): GradeObservation[] {
  return Array.from({ length: n }, (_, i) => ({
    grade,
    stratum,
    cluster: `${grade}-${stratum}-${i}`,
    r: mean + (i % 2 === 0 ? spread : -spread),
  }));
}

describe("compareGradePair", () => {
  it("[UNIT] refuses a verdict below the evidence floor", () => {
    const out = compareGradePair(
      [...block("B", "EURUSD long", 6, 0.5), ...block("C", "EURUSD long", 6, -0.5)],
      "B",
      "C",
    );
    expect(out.verdict).toBe("insufficient_evidence");
    expect(out.diffR).toBeNull();
    expect(out.ci95).toBeNull();
  });

  it("[UNIT] excludes strata where one grade is thin, and reports the exclusion", () => {
    const out = compareGradePair(
      [
        ...block("B", "EURUSD long", 25, 0.4),
        ...block("C", "EURUSD long", 25, 0.1),
        // C-only stratum: cannot contribute to a B-vs-C difference.
        ...block("C", "XAUUSD long", 30, 2),
      ],
      "B",
      "C",
    );
    expect(out.strata.map((s) => s.stratum)).toEqual(["EURUSD long"]);
    expect(out.excludedStrata.map((s) => s.stratum)).toEqual(["XAUUSD long"]);
    expect(out.clustersHigher).toBe(25);
    expect(out.clustersLower).toBe(25);
    // The excluded C-only windfall must not leak into the difference.
    expect(out.diffR).toBeCloseTo(0.3, 6);
    expect(out.verdict).toBe("higher_grade_better");
  });

  it("[UNIT] reports no separation when the interval spans zero", () => {
    const out = compareGradePair(
      [...block("B", "EURUSD long", 25, 0.0, 1.5), ...block("C", "EURUSD long", 25, 0.1, 1.5)],
      "B",
      "C",
    );
    expect(out.verdict).toBe("no_separation");
    expect(out.ci95![0]).toBeLessThan(0);
    expect(out.ci95![1]).toBeGreaterThan(0);
  });

  it("[UNIT] can report the lower grade ahead when matched evidence says so", () => {
    const out = compareGradePair(
      [...block("B", "EURUSD long", 30, -0.2), ...block("C", "EURUSD long", 30, 0.5)],
      "B",
      "C",
    );
    expect(out.verdict).toBe("lower_grade_better");
    expect(out.diffR).toBeCloseTo(-0.7, 6);
  });

  it("[UNIT] collapses repeated fills of one setup into a single observation", () => {
    const repeated: GradeObservation[] = Array.from({ length: 40 }, (_, i) => ({
      grade: "C",
      stratum: "EURUSD long",
      cluster: "one-setup",
      r: i % 2 === 0 ? 5 : -5,
    }));
    const out = compareGradePair(
      [...block("B", "EURUSD long", 30, 0.1), ...block("C", "EURUSD long", 30, 0.1), ...repeated],
      "B",
      "C",
    );
    // 40 extra rows are one cluster, so the C side gains exactly one setup.
    expect(out.clustersLower).toBe(31);
    expect(out.clustersHigher).toBe(30);
  });

  it("[UNIT] requires the floor on both sides, not just in total", () => {
    const out = compareGradePair(
      [
        ...block("B", "EURUSD long", MIN_CLUSTERS_TOTAL + 10, 0.3),
        ...block("C", "EURUSD long", MIN_CLUSTERS_TOTAL - 5, 0.1),
      ],
      "B",
      "C",
    );
    expect(out.verdict).toBe("insufficient_evidence");
  });
});

describe("compareGradeLadder", () => {
  it("[UNIT] compares adjacent grades only", () => {
    const out = compareGradeLadder([
      ...block("A", "EURUSD long", 25, 0.5),
      ...block("B", "EURUSD long", 25, 0.3),
      ...block("C", "EURUSD long", 25, 0.1),
    ]);
    expect(out.map((p) => `${p.higherGrade}>${p.lowerGrade}`)).toEqual(["A>B", "B>C"]);
  });

  it("[UNIT] returns nothing when only one ladder grade is present", () => {
    expect(compareGradeLadder(block("C", "EURUSD long", 30, 0.2))).toEqual([]);
  });
});
