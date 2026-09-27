import { evaluateQCore } from "./engine";
import type { QCoreDecision, QCoreInput } from "./types";
import type { SetupEvaluation } from "@/lib/scanner/profile";

/**
 * Build the immutable point-in-time input vector Q-Core is allowed to see.
 * No broker state, future candles, regime aggregate, or execution result enters
 * this snapshot.
 */
export function qCoreInputFromV1Evaluation(evaluation: SetupEvaluation): QCoreInput | null {
  const profile = evaluation.proposedProfile;
  if (!profile || !evaluation.direction || !profile.pillars) return null;

  return {
    direction: evaluation.direction,
    trend: profile.pillars.trend,
    orderBlock: profile.pillars.orderBlock,
    momentum: profile.pillars.momentum,
    volatilityExpansion: profile.pillars.volatilityExpansion,
    rr: profile.rrRatio,
    maxR: profile.maxR,
    regimeWinRate: null,
    regimeActive: false,
    executionQuality: null,
  };
}

/**
 * Build Q-Core's shadow decision from facts the production V1 evaluator has
 * already derived. Regime and execution quality stay absent until separately
 * proven, time-aligned observations exist.
 */
export function qCoreFromV1Evaluation(evaluation: SetupEvaluation): QCoreDecision | null {
  const input = qCoreInputFromV1Evaluation(evaluation);
  return input ? evaluateQCore(input) : null;
}
