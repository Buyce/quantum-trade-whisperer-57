/**
 * Canonical three-layer trading decision contract.
 * Strategy may propose. Risk and execution may only veto. UNKNOWN fails closed.
 */
export type GateState = "pass" | "fail" | "unknown";
export type VetoLayer = "strategy" | "risk" | "execution";

export interface DecisionGate {
  id: string;
  layer: VetoLayer;
  state: GateState;
  reason: string;
  observedAt?: string | null;
  source?: string | null;
}

export interface TradingDecisionInput {
  instrument: string;
  direction: "long" | "short";
  grade: string | null;
  strategy: readonly DecisionGate[];
  risk: readonly DecisionGate[];
  execution: readonly DecisionGate[];
}

export interface TradingDecision {
  version: 1;
  verdict: "eligible" | "vetoed";
  vetoLayer: VetoLayer | null;
  blockers: DecisionGate[];
  gates: DecisionGate[];
  executionEligible: boolean;
  reason: string;
}
