import type { DecisionGate } from "@/lib/trading-kernel";
import { evaluateTradingDecision } from "@/lib/trading-kernel";

export interface AccountCandidate {
  accountId: string;
  instrument: string;
  direction: "long" | "short";
  grade: string | null;
  strategy: readonly DecisionGate[];
  risk: readonly DecisionGate[];
  execution: readonly DecisionGate[];
  volume: number | null;
}

export interface AccountCandidateVerdict {
  accountId: string;
  eligible: boolean;
  volume: number | null;
  vetoLayer: "strategy" | "risk" | "execution" | null;
  reason: string;
}

/**
 * Evaluate the same setup independently for each account.
 *
 * There is intentionally no "copy lot size" path. Each account must arrive with
 * its own broker/risk-derived volume and its own gates.
 */
export function evaluateAccounts(
  candidates: readonly AccountCandidate[],
): AccountCandidateVerdict[] {
  return candidates.map((candidate) => {
    const decision = evaluateTradingDecision({
      instrument: candidate.instrument,
      direction: candidate.direction,
      grade: candidate.grade,
      strategy: candidate.strategy,
      risk: candidate.risk,
      execution: candidate.execution,
    });
    const volumeValid =
      candidate.volume !== null && Number.isFinite(candidate.volume) && candidate.volume > 0;
    return {
      accountId: candidate.accountId,
      eligible: decision.executionEligible && volumeValid,
      volume: volumeValid ? candidate.volume : null,
      vetoLayer: decision.executionEligible && !volumeValid ? "risk" : decision.vetoLayer,
      reason:
        decision.executionEligible && !volumeValid
          ? "Account-specific broker/risk sizing is unavailable."
          : decision.reason,
    };
  });
}
