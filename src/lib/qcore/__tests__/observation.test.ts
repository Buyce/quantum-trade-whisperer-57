import { describe, expect, it } from "vitest";
import { qCoreFromV1Evaluation } from "../observation";
import type { SetupEvaluation } from "@/lib/scanner/profile";

function evaluation(stage: SetupEvaluation["stage"]): SetupEvaluation {
  return {
    stage,
    gates: [],
    direction: stage === "published" ? "long" : null,
    features: {},
    geometry: {
      entryPrice: null,
      stopLoss: null,
      riskPrice: null,
      structuralEntry: null,
      structureKey: null,
      atr: null,
    },
    counterfactual: stage === "published" ? "executable" : "structurally_not_evaluable",
    proposedProfile:
      stage === "published"
        ? ({
            pillars: {
              trend: 90,
              orderBlock: 80,
              momentum: 70,
              volatilityExpansion: 65,
              passed: 4,
              notes: [],
            },
            rrRatio: 2.2,
            maxR: 2.8,
          } as unknown as SetupEvaluation["proposedProfile"])
        : null,
  };
}

describe("Q-Core observation adapter", () => {
  it("[UNIT] records a shadow decision only when V1 produced a real profile", () => {
    const q = qCoreFromV1Evaluation(evaluation("published"));
    expect(q).not.toBeNull();
    expect(q?.executionEligible).toBe(false);
    expect(q?.mode).toBe("shadow");
  });

  it("[UNIT] does not invent a quant observation for structurally rejected scans", () => {
    expect(qCoreFromV1Evaluation(evaluation("no_abc"))).toBeNull();
  });

  it("[UNIT] does not inject unaligned regime or execution aggregates", () => {
    const q = qCoreFromV1Evaluation(evaluation("published"));
    expect(q?.reasons).toContain("regime_reporting_gate=inactive");
    expect(q?.reasons).toContain("execution_quality=unmeasured");
  });
});
