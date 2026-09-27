import type { QCoreBacktestObservation } from "./backtest";
import { backtestQCore } from "./backtest";
import type { QCorePolicy } from "./config";
import { QCORE_POLICY_V2 } from "./config";

export interface QCoreWalkForwardFold {
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  trainN: number;
  testN: number;
  trainMeanR: number | null;
  testMeanR: number | null;
  testCumulativeR: number;
  testMaxDrawdownR: number;
}

export interface QCoreWalkForwardResult {
  policyId: string;
  folds: QCoreWalkForwardFold[];
  outOfSampleN: number;
  outOfSampleMeanR: number | null;
  outOfSampleCumulativeR: number;
  outOfSampleMaxDrawdownR: number;
  blockers: string[];
}

function utcDay(ts: string): string {
  return ts.slice(0, 10);
}

/**
 * Anchored walk-forward evaluation.
 *
 * The policy is frozen before this function runs. Each fold trains on all prior
 * days and evaluates only the immediately following unseen block. This module
 * measures a policy; it does not tune one, preventing the holdout from becoming
 * an optimizer input.
 */
export function walkForwardQCore(
  observations: readonly QCoreBacktestObservation[],
  options: { minTrainDays?: number; testDays?: number } = {},
  policy: QCorePolicy = QCORE_POLICY_V2,
): QCoreWalkForwardResult {
  const minTrainDays = Math.max(2, options.minTrainDays ?? 20);
  const testDays = Math.max(1, options.testDays ?? 5);
  const rows = [...observations].sort((a, b) => a.detectedAt.localeCompare(b.detectedAt));
  const days = [...new Set(rows.map((r) => utcDay(r.detectedAt)))].sort();
  const folds: QCoreWalkForwardFold[] = [];
  const oos: QCoreBacktestObservation[] = [];

  for (let cut = minTrainDays; cut < days.length; cut += testDays) {
    const trainDays = new Set(days.slice(0, cut));
    const testSlice = days.slice(cut, Math.min(cut + testDays, days.length));
    if (testSlice.length === 0) break;
    const testDaySet = new Set(testSlice);
    const train = rows.filter((r) => trainDays.has(utcDay(r.detectedAt)));
    const test = rows.filter((r) => testDaySet.has(utcDay(r.detectedAt)));
    if (train.length === 0 || test.length === 0) continue;

    const trainResult = backtestQCore(train, policy);
    const testResult = backtestQCore(test, policy);
    oos.push(...test);
    folds.push({
      trainStart: days[0]!,
      trainEnd: days[cut - 1]!,
      testStart: testSlice[0]!,
      testEnd: testSlice[testSlice.length - 1]!,
      trainN: train.length,
      testN: test.length,
      trainMeanR: trainResult.metrics.meanR,
      testMeanR: testResult.metrics.meanR,
      testCumulativeR: testResult.metrics.cumulativeR,
      testMaxDrawdownR: testResult.metrics.maxDrawdownR,
    });
  }

  const blockers: string[] = [];
  if (days.length < minTrainDays + 1) {
    blockers.push(
      `Only ${days.length} measured day(s); need at least ${minTrainDays + 1} for one unseen fold.`,
    );
  }
  if (folds.length === 0 && blockers.length === 0) {
    blockers.push("No chronological fold contained both training and unseen observations.");
  }

  const combined = backtestQCore(oos, policy);
  return {
    policyId: policy.id,
    folds,
    outOfSampleN: combined.metrics.resolvedN,
    outOfSampleMeanR: combined.metrics.meanR,
    outOfSampleCumulativeR: combined.metrics.cumulativeR,
    outOfSampleMaxDrawdownR: combined.metrics.maxDrawdownR,
    blockers,
  };
}
