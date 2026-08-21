import { describe, expect, it } from "vitest";
import {
  classifyCounterfactual,
  type EvaluationStage,
  type PartialGeometry,
  type SetupEvaluation,
} from "@/lib/scanner/profile";
import {
  buildCounterfactualPlan,
  RESEARCH_PLAN_VERSION,
  RESEARCH_TP_R,
} from "../counterfactual-plan";

const GEOMETRY: PartialGeometry = {
  entryPrice: 1.1,
  stopLoss: 1.09,
  riskPrice: 0.01,
  structuralEntry: 1.1,
  structureKey: "EURUSD|long|a|b|1.09000",
  atr: 0.004,
};

const EMPTY: PartialGeometry = {
  entryPrice: null,
  stopLoss: null,
  riskPrice: null,
  structuralEntry: null,
  structureKey: null,
  atr: null,
};

function evaluation(over: Partial<SetupEvaluation> = {}): SetupEvaluation {
  const stage = over.stage ?? "no_headroom";
  const geometry = over.geometry ?? GEOMETRY;
  const direction = over.direction === undefined ? "long" : over.direction;
  return {
    stage,
    gates: [],
    direction,
    features: { gradedTier: "B" },
    geometry,
    counterfactual: classifyCounterfactual(stage, geometry, direction),
    proposedProfile: null,
    ...over,
  };
}

const FILTER_STAGES: EvaluationStage[] = ["risk_too_wide", "no_headroom", "unreachable_r"];
const STRUCTURAL_STAGES: EvaluationStage[] = [
  "no_candles",
  "m15_neutral",
  "no_grade",
  "no_abc",
  "risk_undefined",
];

describe("Prompt 7G — counterfactual classification", () => {
  it("[INVARIANT] a published evaluation is always executable", () => {
    expect(classifyCounterfactual("published", GEOMETRY, "long")).toBe("executable");
  });

  it.each(FILTER_STAGES)(
    "[INVARIANT] %s with fully derived geometry is counterfactually executable",
    (stage) => {
      expect(classifyCounterfactual(stage, GEOMETRY, "long")).toBe("executable");
    },
  );

  it.each(STRUCTURAL_STAGES)("[INVARIANT] %s can never be forward-tested", (stage) => {
    expect(classifyCounterfactual(stage, EMPTY, null)).toBe("structurally_not_evaluable");
  });

  it("[INVARIANT] a filter stage without geometry is never promoted", () => {
    expect(classifyCounterfactual("no_headroom", EMPTY, "long")).toBe(
      "structurally_not_evaluable",
    );
    expect(
      classifyCounterfactual("no_headroom", { ...GEOMETRY, riskPrice: 0 }, "long"),
    ).toBe("structurally_not_evaluable");
    expect(classifyCounterfactual("no_headroom", GEOMETRY, null)).toBe(
      "structurally_not_evaluable",
    );
  });
});

describe("Prompt 7G — the frozen research ladder", () => {
  it("[INVARIANT] the ladder is a fixed 1R/2R/3R extension off derived risk (long)", () => {
    const plan = buildCounterfactualPlan(evaluation())!;
    expect(RESEARCH_TP_R).toEqual([1, 2, 3]);
    expect(plan.tp1).toBeCloseTo(1.11, 10);
    expect(plan.tp2).toBeCloseTo(1.12, 10);
    expect(plan.tp3).toBeCloseTo(1.13, 10);
    expect([plan.tp1R, plan.tp2R, plan.tp3R, plan.maxR]).toEqual([1, 2, 3, 3]);
    expect(plan.researchPlanVersion).toBe(RESEARCH_PLAN_VERSION);
    expect(plan.grade).toBe("B");
  });

  it("[INVARIANT] short targets travel the other way", () => {
    const plan = buildCounterfactualPlan(
      evaluation({
        direction: "short",
        geometry: { ...GEOMETRY, entryPrice: 1.1, stopLoss: 1.11, riskPrice: 0.01 },
      }),
    )!;
    expect(plan.tp1).toBeCloseTo(1.09, 10);
    expect(plan.tp3).toBeCloseTo(1.07, 10);
  });

  it("[INVARIANT] no plan is ever produced for a published evaluation", () => {
    expect(buildCounterfactualPlan(evaluation({ stage: "published" }))).toBeNull();
  });

  it.each(STRUCTURAL_STAGES)("[INVARIANT] no plan is invented for %s", (stage) => {
    expect(buildCounterfactualPlan(evaluation({ stage, geometry: EMPTY, direction: null }))).toBeNull();
  });

  it("[INVARIANT] a missing graded tier blocks the plan rather than guessing one", () => {
    expect(buildCounterfactualPlan(evaluation({ features: {} }))).toBeNull();
  });

  it("[INVARIANT] zero or negative risk can never produce targets", () => {
    expect(
      buildCounterfactualPlan(evaluation({ geometry: { ...GEOMETRY, riskPrice: 0 } })),
    ).toBeNull();
  });
});
