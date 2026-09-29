import { describe, expect, it } from "vitest";
import { evaluateTradingDecision } from "../decision";
import { calculateBotQuality } from "../quality";
import type { DecisionGate } from "../types";

const gate = (
  id: string,
  layer: DecisionGate["layer"],
  state: DecisionGate["state"] = "pass",
): DecisionGate => ({ id, layer, state, reason: state });

describe("trading kernel", () => {
  it("[INVARIANT] requires every veto layer to pass before execution eligibility", () => {
    const decision = evaluateTradingDecision({
      instrument: "XAUUSD",
      direction: "long",
      grade: "A",
      strategy: [gate("setup", "strategy")],
      risk: [gate("risk_policy", "risk")],
      execution: [gate("broker", "execution")],
    });
    expect(decision.executionEligible).toBe(true);
    expect(decision.verdict).toBe("eligible");
  });

  it("[INVARIANT] fails closed when a layer is unmeasured", () => {
    const decision = evaluateTradingDecision({
      instrument: "XAUUSD",
      direction: "long",
      grade: "A",
      strategy: [gate("setup", "strategy")],
      risk: [],
      execution: [gate("broker", "execution")],
    });
    expect(decision.executionEligible).toBe(false);
    expect(decision.vetoLayer).toBe("risk");
    expect(decision.blockers[0]?.state).toBe("unknown");
  });

  it("[INVARIANT] never lets execution override a strategy veto", () => {
    const decision = evaluateTradingDecision({
      instrument: "EURUSD",
      direction: "short",
      grade: "B",
      strategy: [gate("grade", "strategy", "fail")],
      risk: [gate("risk_policy", "risk")],
      execution: [gate("broker", "execution")],
    });
    expect(decision.executionEligible).toBe(false);
    expect(decision.vetoLayer).toBe("strategy");
  });

  it("[UNIT] computes expectancy after costs and maximum drawdown in R", () => {
    const metrics = calculateBotQuality([
      { grossR: 2, costsR: 0.1 },
      { grossR: -1, costsR: 0.1 },
      { grossR: 1.5, costsR: 0.1 },
      { grossR: -1, costsR: 0.1 },
    ]);
    expect(metrics.expectancyR).toBe(0.25);
    expect(metrics.cumulativeNetR).toBe(1);
    expect(metrics.maxDrawdownR).toBe(1.1);
    expect(metrics.profitFactor).toBeCloseTo(1.5, 4);
  });
});
