import { describe, expect, it } from "vitest";
import { MIN_ARM_SAMPLES, summarizeFilterLift, type FilterLiftRow } from "@/lib/learning/filter-lift";

function row(over: Partial<FilterLiftRow>): FilterLiftRow {
  return {
    gate: "headroom",
    arm: "pass",
    mean_r: 0.2,
    se_r: 0.05,
    n_used: 100,
    n_mature: 100,
    n_resolved: 100,
    n_candidates: 120,
    stat_status: "descriptive",
    reason: null,
    replay_coverage: 1,
    ...over,
  };
}

describe("summarizeFilterLift", () => {
  it("returns nothing for no rows rather than an invented gate", () => {
    expect(summarizeFilterLift([])).toEqual([]);
  });

  it("labels a gate not-yet-decidable when one arm is missing", () => {
    const [gate] = summarizeFilterLift([row({ arm: "pass" })]);
    expect(gate!.verdict).toBe("not_yet_decidable");
    expect(gate!.detail).toContain("rejected arm");
    expect(gate!.deltaR).toBeNull();
  });

  it("names how many samples are still missing", () => {
    const [gate] = summarizeFilterLift([
      row({ arm: "pass" }),
      row({ arm: "fail", n_used: 10, n_mature: 10 }),
    ]);
    expect(gate!.verdict).toBe("not_yet_decidable");
    expect(gate!.detail).toContain(`${MIN_ARM_SAMPLES - 10} more matured samples`);
  });

  it("never reads a non-descriptive arm as a result", () => {
    const [gate] = summarizeFilterLift([
      row({ arm: "pass" }),
      row({ arm: "fail", stat_status: "insufficient_coverage", reason: "coverage 0.4" }),
    ]);
    expect(gate!.verdict).toBe("not_yet_decidable");
    expect(gate!.detail).toContain("coverage 0.4");
  });

  it("supports loosening only when the rejected arm's interval clears the published one", () => {
    const [gate] = summarizeFilterLift([
      row({ arm: "pass", mean_r: 0.1, se_r: 0.02 }),
      row({ arm: "fail", mean_r: 0.6, se_r: 0.03 }),
    ]);
    expect(gate!.verdict).toBe("loosening_supported");
    expect(gate!.deltaR).toBeCloseTo(0.5, 6);
  });

  it("supports the gate when the published arm clears the rejected one", () => {
    const [gate] = summarizeFilterLift([
      row({ arm: "pass", mean_r: 0.7, se_r: 0.02 }),
      row({ arm: "fail", mean_r: -0.1, se_r: 0.03 }),
    ]);
    expect(gate!.verdict).toBe("gate_supported");
  });

  it("reads overlapping intervals as no difference, not a recommendation", () => {
    const [gate] = summarizeFilterLift([
      row({ arm: "pass", mean_r: 0.2, se_r: 0.2 }),
      row({ arm: "fail", mean_r: 0.3, se_r: 0.2 }),
    ]);
    expect(gate!.verdict).toBe("no_difference");
  });

  it("keeps gates sorted and separate", () => {
    const gates = summarizeFilterLift([
      row({ gate: "reachable_r", arm: "pass" }),
      row({ gate: "reachable_r", arm: "fail" }),
      row({ gate: "headroom", arm: "pass" }),
      row({ gate: "headroom", arm: "fail" }),
    ]);
    expect(gates.map((g) => g.gate)).toEqual(["headroom", "reachable_r"]);
  });
});
