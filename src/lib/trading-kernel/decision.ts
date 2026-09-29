import type { DecisionGate, TradingDecision, TradingDecisionInput, VetoLayer } from "./types";

const LAYERS: readonly VetoLayer[] = ["strategy", "risk", "execution"];

function layerGates(input: TradingDecisionInput, layer: VetoLayer): readonly DecisionGate[] {
  return input[layer];
}

/** Canonical fail-closed P-Trades veto chain. */
export function evaluateTradingDecision(input: TradingDecisionInput): TradingDecision {
  const all = [...input.strategy, ...input.risk, ...input.execution];
  for (const layer of LAYERS) {
    const gates = layerGates(input, layer);
    if (gates.length === 0) {
      const synthetic: DecisionGate = {
        id: `${layer}_evidence_missing`,
        layer,
        state: "unknown",
        reason: `No ${layer} evidence was supplied; fail closed.`,
        source: "trading-kernel",
      };
      return {
        version: 1,
        verdict: "vetoed",
        vetoLayer: layer,
        blockers: [synthetic],
        gates: [...all, synthetic],
        executionEligible: false,
        reason: synthetic.reason,
      };
    }

    const blockers = gates.filter((gate) => gate.state !== "pass");
    if (blockers.length > 0) {
      return {
        version: 1,
        verdict: "vetoed",
        vetoLayer: layer,
        blockers,
        gates: all,
        executionEligible: false,
        reason: blockers.map((gate) => `${gate.id}: ${gate.reason}`).join("; "),
      };
    }
  }

  return {
    version: 1,
    verdict: "eligible",
    vetoLayer: null,
    blockers: [],
    gates: all,
    executionEligible: true,
    reason: "Strategy, risk and execution layers all passed.",
  };
}
