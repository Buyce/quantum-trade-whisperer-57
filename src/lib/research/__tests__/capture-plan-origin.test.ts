import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase, type FakeCall } from "@/test/fakes/supabase";
import {
  classifyCounterfactual,
  type EvaluationStage,
  type PartialGeometry,
  type SetupEvaluation,
} from "@/lib/scanner/profile";
import { captureCandidate } from "../candidates.server";
import { RESEARCH_PLAN_VERSION } from "../counterfactual-plan";

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

function evaluation(stage: EvaluationStage, geometry: PartialGeometry): SetupEvaluation {
  const direction = geometry === EMPTY ? null : "long";
  return {
    stage,
    gates: Array.from({ length: 8 }, (_, i) => ({
      gate: ["candles_present", "m15_direction", "grade", "abc_structure", "risk_defined",
        "risk_ceiling", "headroom", "reachable_r"][i] as never,
      outcome: "pass" as const,
    })),
    direction,
    features: { gradedTier: "B" },
    geometry,
    counterfactual: classifyCounterfactual(stage, geometry, direction),
    proposedProfile: null,
  };
}

async function capture(e: SetupEvaluation): Promise<Record<string, unknown>> {
  const calls: FakeCall[] = [];
  const fake = createFakeSupabase((c) => {
    calls.push(c);
    if (c.table === "shadow_engine_state" && c.op === "select")
      return { data: { candidate_capture_enabled: true }, error: null };
    return { data: null, error: null };
  });
  await captureCandidate(fake.client as SupabaseClient, {
    runId: "run-1",
    observationKey: "run-1|EURUSD",
    instrument: "EURUSD",
    detectedAt: "2026-08-21T10:00:00.000Z",
    session: "london",
    volatilityIndex: 1.1,
    evaluation: e,
    v1Decision: "no_trade",
    publishedSignalId: null,
  });
  const insert = fake.calls.find((c) => c.table === "research_candidates" && c.op === "insert");
  return (insert?.payload ?? {}) as Record<string, unknown>;
}

describe("Prompt 7G — captured plan provenance", () => {
  it("[INVARIANT] a filter-rejected setup is stored as a version-pinned counterfactual plan", async () => {
    const p = await capture(evaluation("no_headroom", GEOMETRY));
    expect(p["plan_origin"]).toBe("counterfactual");
    expect(p["counterfactual_stage"]).toBe("no_headroom");
    expect(p["research_plan_version"]).toBe(RESEARCH_PLAN_VERSION);
    expect(p["counterfactual_class"]).toBe("executable");
    expect(p["grade"]).toBe("B");
    expect(p["tp1"]).toBeCloseTo(1.11, 10);
    expect(p["tp3"]).toBeCloseTo(1.13, 10);
    expect([p["tp1_r"], p["tp2_r"], p["tp3_r"], p["max_r"]]).toEqual([1, 2, 3, 3]);
    // The counterfactual is a research plan, not a graded production one.
    expect(p["confidence_score"]).toBeNull();
    // Geometry is passed through untouched — nothing is re-derived.
    expect(p["entry_price"]).toBe(GEOMETRY.entryPrice);
    expect(p["stop_loss"]).toBe(GEOMETRY.stopLoss);
  });

  it("[INVARIANT] a structurally impossible setup stores no plan at all", async () => {
    const p = await capture(evaluation("no_abc", EMPTY));
    expect(p["plan_origin"]).toBeNull();
    expect(p["counterfactual_stage"]).toBeNull();
    expect(p["research_plan_version"]).toBeNull();
    expect(p["counterfactual_class"]).toBe("structurally_not_evaluable");
    for (const k of ["grade", "tp1", "tp2", "tp3", "tp1_r", "tp2_r", "tp3_r", "max_r"]) {
      expect(p[k]).toBeNull();
    }
  });
});
