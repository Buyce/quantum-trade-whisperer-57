import { evaluateQCore } from "./engine";
import type { QCoreDecision } from "./types";
import type { SetupEvaluation } from "@/lib/scanner/profile";

/**
 * Build Q-Core's shadow observation from facts the production V1 evaluator has
 * already derived. This adapter never reads broker state and never mutates the
 * scanner evaluation.
 *
 * Regime and execution-quality inputs intentionally remain absent here. They
 * require separately proven, time-aligned observations; Q-Core must not smuggle
 * a stale aggregate into a per-scan feature vector.
 */
export function qCoreFromV1Evaluation(evaluation: SetupEvaluation): QCoreDecision | null {
  const profile = evaluation.proposedProfile;
  if (!profile || !evaluation.direction) return null;

  return evaluateQCore({
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
  });
}
