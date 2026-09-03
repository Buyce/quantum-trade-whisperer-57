/**
 * Pure tests for the learning-evidence summarizers: slice floors, interval
 * handling, and the no-mixing rule between global and slice rows.
 */
import { describe, expect, it } from "vitest";
import {
  ci95,
  globalRows,
  intervalsOverlap,
  sliceDecidable,
  slicesByDim,
  type LearningStatRow,
} from "@/lib/learning/evidence";

function row(partial: Partial<LearningStatRow>): LearningStatRow {
  return {
    manifest_hash: "abc",
    gate: "risk_ceiling",
    arm: "pass",
    slice_dim: "global",
    slice_key: "",
    n_candidates: 50,
    n_mature: 48,
    n_used: 40,
    cluster_n: 12,
    replay_coverage: 0.99,
    mean_r: 0.1,
    se_r: 0.05,
    stat_status: "descriptive",
    reason: null,
    computed_as_of: "2026-09-03T00:00:00Z",
    ...partial,
  };
}

describe("ci95", () => {
  it("[UNIT] builds a symmetric 95% interval from the cluster-robust SE", () => {
    expect(ci95({ mean_r: 0.1, se_r: 0.05 })).toEqual([
      expect.closeTo(0.1 - 1.96 * 0.05, 10),
      expect.closeTo(0.1 + 1.96 * 0.05, 10),
    ]);
  });

  it("[UNIT] refuses to invent an interval when the database stored no SE", () => {
    expect(ci95({ mean_r: 0.4, se_r: null })).toBeNull();
    expect(ci95({ mean_r: null, se_r: 0.1 })).toBeNull();
  });
});

describe("intervalsOverlap", () => {
  it("[UNIT] detects separation and overlap", () => {
    expect(intervalsOverlap([0.1, 0.3], [0.4, 0.6])).toBe(false);
    expect(intervalsOverlap([0.1, 0.5], [0.4, 0.6])).toBe(true);
    expect(intervalsOverlap([0.1, 0.3], [0.3, 0.5])).toBe(true);
  });
});

describe("globalRows / slicesByDim", () => {
  const rows = [
    row({ slice_dim: "global" }),
    row({ slice_dim: "instrument", slice_key: "EURUSD" }),
    row({ slice_dim: "instrument", slice_key: "EURUSD", arm: "fail" }),
    row({ slice_dim: "session", slice_key: "london" }),
  ];

  it("[UNIT] keeps slice rows out of the global read", () => {
    expect(globalRows(rows)).toHaveLength(1);
  });

  it("[UNIT] groups slices by dimension with pass arm before fail", () => {
    const grouped = slicesByDim(rows);
    expect(grouped.instrument.map((r) => r.arm)).toEqual(["fail", "pass"]);
    expect(grouped.session).toHaveLength(1);
    expect(grouped.direction).toHaveLength(0);
  });
});

describe("sliceDecidable", () => {
  it("[UNIT] requires descriptive status, 30+ samples and intervals on both arms", () => {
    const pass = row({ arm: "pass" });
    const fail = row({ arm: "fail", mean_r: -0.2 });
    expect(sliceDecidable(pass, fail)).toBe(true);

    expect(sliceDecidable(row({ n_used: 12 }), fail)).toBe(false);
    expect(sliceDecidable(pass, row({ arm: "fail", stat_status: "insufficient_sample" }))).toBe(
      false,
    );
    expect(sliceDecidable(row({ se_r: null }), fail)).toBe(false);
    expect(sliceDecidable(undefined, fail)).toBe(false);
  });
});
