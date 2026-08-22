import { describe, expect, it } from "vitest";
import { computeNetR, computeR, RMathInputError, R_MATH_VERSION, selectR } from "../r-math";
import { collectSingleBasis, basisLabel } from "../basis";

describe("canonical R mathematics", () => {
  it("[UNIT] F1 long winner, actual stop recorded: both bases differ and are reported separately", () => {
    const r = computeR({
      outcome: "win",
      direction: "long",
      plannedEntry: 100,
      plannedStop: 98,
      actualEntryPrice: 101,
      actualExitPrice: 105,
      actualInitialStop: 99,
    });
    // gross_move = 105 - 101 = 4; planned risk = 2; actual risk = |101-99| = 2
    expect(r.grossMove).toBe(4);
    expect(r.rVsPlan).toBe(2);
    expect(r.rVsActualRisk).toBe(2);
    expect(r.stopProvenance).toBe("actual_stop");
    expect(r.availability).toBe("both");
    expect(r.rMathVersion).toBe(R_MATH_VERSION);
  });

  it("[INVARIANT] F2 slipped long entry: numerator anchors on the actual fill, never the plan", () => {
    const r = computeR({
      outcome: "win",
      direction: "long",
      plannedEntry: 100,
      plannedStop: 98,
      actualEntryPrice: 102,
      actualExitPrice: 104,
      actualInitialStop: null,
    });
    // gross_move = 104 - 102 = 2 (NOT 104 - 100 = 4)
    expect(r.grossMove).toBe(2);
    expect(r.rVsPlan).toBe(1);
    // stop_ref falls back to planned stop 98 => actual risk = |102-98| = 4
    expect(r.rVsActualRisk).toBe(0.5);
    expect(r.stopProvenance).toBe("planned_stop_fallback");
  });

  it("[UNIT] F3 short winner", () => {
    const r = computeR({
      outcome: "win",
      direction: "short",
      plannedEntry: 200,
      plannedStop: 204,
      actualEntryPrice: 199,
      actualExitPrice: 191,
      actualInitialStop: 203,
    });
    expect(r.grossMove).toBe(8);
    expect(r.rVsPlan).toBe(2);
    expect(r.rVsActualRisk).toBe(2);
  });

  it("[UNIT] F4 short loser produces a negative R on both bases", () => {
    const r = computeR({
      outcome: "loss",
      direction: "short",
      plannedEntry: 200,
      plannedStop: 204,
      actualEntryPrice: 200,
      actualExitPrice: 203,
      actualInitialStop: 204,
    });
    expect(r.rVsPlan).toBe(-0.75);
    expect(r.rVsActualRisk).toBe(-0.75);
  });

  it("[UNIT] F5 open trade has no R at all", () => {
    const r = computeR({
      outcome: "open",
      direction: "long",
      plannedEntry: 100,
      plannedStop: 98,
      actualEntryPrice: null,
      actualExitPrice: null,
    });
    expect(r.rVsPlan).toBeNull();
    expect(r.rVsActualRisk).toBeNull();
    expect(r.availability).toBe("unavailable_open");
  });

  it("[UNIT] F6 resolved without prices yields NULL R, not zero", () => {
    const r = computeR({
      outcome: "win",
      direction: "long",
      plannedEntry: 100,
      plannedStop: 98,
      actualEntryPrice: null,
      actualExitPrice: null,
    });
    expect(r.rVsPlan).toBeNull();
    expect(r.rVsActualRisk).toBeNull();
    expect(r.availability).toBe("unavailable_no_prices");
  });

  it("[INVARIANT] F7 missing plan snapshot yields actual-risk only when a stop exists", () => {
    const r = computeR({
      outcome: "win",
      direction: "long",
      plannedEntry: null,
      plannedStop: null,
      actualEntryPrice: 100,
      actualExitPrice: 103,
      actualInitialStop: 99,
    });
    expect(r.rVsPlan).toBeNull();
    expect(r.rVsActualRisk).toBe(3);
    expect(r.availability).toBe("actual_risk_only");
  });

  it("[UNIT] no plan and no stop at all is explicitly unavailable", () => {
    const r = computeR({
      outcome: "win",
      direction: "long",
      plannedEntry: null,
      plannedStop: null,
      actualEntryPrice: 100,
      actualExitPrice: 103,
      actualInitialStop: null,
    });
    expect(r.availability).toBe("unavailable_no_plan");
    expect(r.stopProvenance).toBe("unavailable");
  });

  it("[INVARIANT] zero risk distance is refused rather than dividing by zero", () => {
    // Zero PLANNED risk: no error, both bases simply unavailable.
    const r = computeR({
      outcome: "win",
      direction: "long",
      plannedEntry: 100,
      plannedStop: 100,
      actualEntryPrice: 100,
      actualExitPrice: 103,
      actualInitialStop: null,
    });
    expect(r.rVsPlan).toBeNull();
    expect(r.rVsActualRisk).toBeNull();
    expect(r.availability).toBe("unavailable_zero_risk");

    // Zero ACTUAL stop distance is impossible geometry: rejected outright.
    expect(() =>
      computeR({
        outcome: "win",
        direction: "long",
        plannedEntry: 100,
        plannedStop: 100,
        actualEntryPrice: 100,
        actualExitPrice: 103,
        actualInitialStop: 100,
      }),
    ).toThrow(RMathInputError);
  });

  it("[UNIT] one-sided prices raise a validation error", () => {
    expect(() =>
      computeR({
        outcome: "win",
        direction: "long",
        plannedEntry: 100,
        plannedStop: 98,
        actualEntryPrice: 101,
        actualExitPrice: null,
      }),
    ).toThrowError(RMathInputError);
    try {
      computeR({
        outcome: "win",
        direction: "long",
        plannedEntry: 100,
        plannedStop: 98,
        actualEntryPrice: null,
        actualExitPrice: 105,
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as RMathInputError).code).toBe("one_sided_prices");
    }
  });

  it("[INVARIANT] selectR never falls back to the other basis", () => {
    const row = { r_vs_plan: null, r_vs_actual_risk: 1.5 };
    expect(selectR(row, "plan")).toBeNull();
    expect(selectR(row, "actual_risk")).toBe(1.5);
  });
});

describe("basis aggregation guard", () => {
  it("[UNIT] a row holding both values aggregates cleanly under either basis", () => {
    const plan = collectSingleBasis(
      [
        { basis: "plan", provenance: "canonical", r: 2 },
        { basis: "plan", provenance: "canonical", r: -1 },
      ],
      "plan",
    );
    expect(plan.status).toBe("ok");
    expect(plan.values).toEqual([2, -1]);
  });

  it("[INVARIANT] mixed bases are refused as an aggregation error", () => {
    const mixed = collectSingleBasis(
      [
        { basis: "plan", provenance: "canonical", r: 2 },
        { basis: "actual_risk", provenance: "canonical", r: 1 },
      ],
      "plan",
    );
    expect(mixed.status).toBe("mixed_basis");
    expect(mixed.n).toBe(0);
  });

  it("[INVARIANT] legacy provenance is never pooled with canonical", () => {
    const mixed = collectSingleBasis(
      [
        { basis: "plan", provenance: "canonical", r: 2 },
        { basis: "plan", provenance: "legacy", r: 1 },
      ],
      "plan",
    );
    expect(mixed.status).toBe("mixed_basis");
  });

  it("[INVARIANT] empty is distinct from mixed", () => {
    expect(collectSingleBasis([], "plan").status).toBe("empty");
  });

  it("[UNIT] labels name the unit of account", () => {
    expect(basisLabel("plan")).toContain("planned risk");
    expect(basisLabel("actual_risk")).toContain("actual risk");
    expect(basisLabel("plan", "legacy")).toContain("legacy");
  });
});

describe("monetary costs", () => {
  it("[UNIT] no recorded costs leaves net R unavailable with gross intact", () => {
    const out = computeNetR(2, {
      commission: null,
      swap: null,
      costCurrency: null,
      costUnit: null,
    });
    expect(out.netR).toBeNull();
    expect(out.status).toBe("no_costs_recorded");
  });

  it("[INVARIANT] recorded money without conversion provenance cannot become R", () => {
    const out = computeNetR(2, {
      commission: 7,
      swap: 1.25,
      costCurrency: "USD",
      costUnit: "account_currency",
    });
    expect(out.netR).toBeNull();
    expect(out.status).toBe("no_conversion_provenance");
    expect(out.note).not.toMatch(/net R is/i);
  });

  it("[UNIT] documented conversion produces net R", () => {
    const out = computeNetR(2, {
      commission: 5,
      swap: 5,
      costCurrency: "USD",
      costUnit: "account_currency",
      documentedRValueInCostCurrency: 100,
    });
    expect(out.status).toBe("computed");
    expect(out.netR).toBe(1.9);
  });

  it("[UNIT] gross unavailable means net unavailable", () => {
    const out = computeNetR(null, {
      commission: 5,
      swap: 0,
      costCurrency: "USD",
      costUnit: "account_currency",
      documentedRValueInCostCurrency: 100,
    });
    expect(out.status).toBe("unavailable_gross");
  });
});

describe("actual-stop geometry (shared by web and MCP)", () => {
  const base = {
    outcome: "win" as const,
    plannedEntry: 100,
    plannedStop: 98,
    actualEntryPrice: 101,
    actualExitPrice: 105,
  };

  it("[INVARIANT] a long stop at or above the actual entry is impossible, never a valid actual-risk R", () => {
    for (const stop of [101, 102]) {
      const call = () => computeR({ ...base, direction: "long", actualInitialStop: stop });
      expect(call).toThrow(RMathInputError);
      try {
        call();
      } catch (err) {
        expect((err as RMathInputError).code).toBe("impossible_stop_geometry");
      }
    }
  });

  it("[INVARIANT] a short stop at or below the actual entry is impossible", () => {
    for (const stop of [101, 100] as const) {
      const call = () =>
        computeR({
          ...base,
          direction: "short",
          actualEntryPrice: 101,
          actualExitPrice: 97,
          plannedEntry: 100,
          plannedStop: 102,
          actualInitialStop: stop,
        });
      expect(call).toThrow(RMathInputError);
    }
  });

  it("[UNIT] correct-side stops still compute both bases", () => {
    const long = computeR({ ...base, direction: "long", actualInitialStop: 99 });
    expect(long.rVsActualRisk).toBe(2);
    const short = computeR({
      outcome: "win",
      direction: "short",
      plannedEntry: 100,
      plannedStop: 102,
      actualEntryPrice: 101,
      actualExitPrice: 97,
      actualInitialStop: 103,
    });
    expect(short.grossMove).toBe(4);
    expect(short.rVsActualRisk).toBe(2);
    expect(short.stopProvenance).toBe("actual_stop");
  });

  it("[INVARIANT] a zero-distance actual stop is rejected rather than dividing by zero", () => {
    expect(() => computeR({ ...base, direction: "long", actualInitialStop: 101 })).toThrow(
      /below its actual entry|non-zero/,
    );
  });
});

describe("direction fails closed", () => {
  it("[INVARIANT] a null direction on long-shaped prices yields no R, never a long assumption", () => {
    const r = computeR({
      outcome: "win",
      direction: null,
      plannedEntry: 100,
      plannedStop: 98,
      actualEntryPrice: 101,
      actualExitPrice: 105,
      actualInitialStop: null,
    });
    expect(r.availability).toBe("unavailable_no_direction");
    expect(r.rVsPlan).toBeNull();
    expect(r.rVsActualRisk).toBeNull();
    expect(r.grossMove).toBeNull();
  });

  it("[INVARIANT] a null direction on short-shaped prices yields no R", () => {
    const r = computeR({
      outcome: "loss",
      direction: null,
      plannedEntry: 100,
      plannedStop: 102,
      actualEntryPrice: 100,
      actualExitPrice: 102,
      actualInitialStop: null,
    });
    expect(r.availability).toBe("unavailable_no_direction");
    expect(r.rVsPlan).toBeNull();
    expect(r.rVsActualRisk).toBeNull();
  });

  it("[INVARIANT] stop geometry is not asserted when direction is unknown", () => {
    expect(() =>
      computeR({
        outcome: "win",
        direction: null,
        plannedEntry: 100,
        plannedStop: 98,
        actualEntryPrice: 101,
        actualExitPrice: 105,
        actualInitialStop: 130,
      }),
    ).not.toThrow();
  });
});
