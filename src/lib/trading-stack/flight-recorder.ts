import type { TradingDecision } from "@/lib/trading-kernel";

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

/**
 * Builds the immutable payload shape to persist at the execution boundary.
 * Storage is deliberately separate so decision construction stays testable.
 */
export function flightRecord(input: DecisionFlightRecord): Readonly<DecisionFlightRecord> {
  return Object.freeze({
    ...input,
    modelVersions: Object.freeze({ ...input.modelVersions }),
    decision: Object.freeze({ ...input.decision }),
  });
}
