import type { DecisionGate, TradingDecision } from "@/lib/trading-kernel";

export interface DecisionFlightRecord {
  version: 1;
  decisionId: string;
  observedAt: string;
  instrument: string;
  direction: "long" | "short";
  grade: string | null;
  accountId: string | null;
  brokerProvider: "metaapi" | "mt5_direct" | null;
  quoteObservedAt: string | null;
  regime: string | null;
  session: string | null;
  newsState: "clear" | "blocked" | "unknown";
  decision: TradingDecision;
  modelVersions: Record<string, string | number>;
}

export type FrozenTradingDecision = Omit<Readonly<TradingDecision>, "blockers" | "gates"> & {
  readonly blockers: readonly Readonly<DecisionGate>[];
  readonly gates: readonly Readonly<DecisionGate>[];
};

export type FrozenDecisionFlightRecord = Omit<
  Readonly<DecisionFlightRecord>,
  "decision" | "modelVersions"
> & {
  readonly decision: FrozenTradingDecision;
  readonly modelVersions: Readonly<Record<string, string | number>>;
};

function freezeGate(gate: DecisionGate): Readonly<DecisionGate> {
  return Object.freeze({ ...gate });
}

function freezeDecision(decision: TradingDecision): FrozenTradingDecision {
  return Object.freeze({
    ...decision,
    blockers: Object.freeze(decision.blockers.map(freezeGate)),
    gates: Object.freeze(decision.gates.map(freezeGate)),
  });
}

/**
 * Builds a deeply immutable execution-boundary snapshot.
 * Storage is deliberately separate so decision construction stays testable.
 */
export function flightRecord(input: DecisionFlightRecord): FrozenDecisionFlightRecord {
  return Object.freeze({
    ...input,
    modelVersions: Object.freeze({ ...input.modelVersions }),
    decision: freezeDecision(input.decision),
  });
}
