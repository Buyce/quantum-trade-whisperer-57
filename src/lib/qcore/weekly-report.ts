import type { QCoreBacktestObservation } from "./backtest";
import { backtestQCore } from "./backtest";
import { walkForwardQCore } from "./walk-forward";
import type { QCorePolicy } from "./config";
import { QCORE_POLICY_V2 } from "./config";

export interface QCoreWeeklyResearchReport {
  policyId: string;
  windowStart: string;
  windowEnd: string;
  observations: number;
  resolved: number;
  meanR: number | null;
  winRate: number | null;
  cumulativeR: number;
  maxDrawdownR: number;
  stateCounts: { long: number; neutral: number; short: number };
  walkForward: {
    folds: number;
    outOfSampleN: number;
    outOfSampleMeanR: number | null;
    outOfSampleCumulativeR: number;
    outOfSampleMaxDrawdownR: number;
    blockers: string[];
  };
}

/**
 * Pure weekly Q-Core research summary. The caller supplies point-in-time
 * observations from the research ledger; no broker or execution path is read.
 */
export function buildQCoreWeeklyResearchReport(
  observations: readonly QCoreBacktestObservation[],
  windowStart: string,
  windowEnd: string,
  policy: QCorePolicy = QCORE_POLICY_V2,
): QCoreWeeklyResearchReport {
  const inWindow = observations.filter(
    (o) => o.detectedAt >= windowStart && o.detectedAt <= windowEnd,
  );
  const weekly = backtestQCore(inWindow, policy);
  const wf = walkForwardQCore(observations, {}, policy);

  return {
    policyId: policy.id,
    windowStart,
    windowEnd,
    observations: weekly.metrics.n,
    resolved: weekly.metrics.resolvedN,
    meanR: weekly.metrics.meanR,
    winRate: weekly.metrics.winRate,
    cumulativeR: weekly.metrics.cumulativeR,
    maxDrawdownR: weekly.metrics.maxDrawdownR,
    stateCounts: weekly.metrics.stateCounts,
    walkForward: {
      folds: wf.folds.length,
      outOfSampleN: wf.outOfSampleN,
      outOfSampleMeanR: wf.outOfSampleMeanR,
      outOfSampleCumulativeR: wf.outOfSampleCumulativeR,
      outOfSampleMaxDrawdownR: wf.outOfSampleMaxDrawdownR,
      blockers: wf.blockers,
    },
  };
}
