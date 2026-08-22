/**
 * Execution-only exposure limits.
 *
 * The same journal-derived numbers are ADVISORY everywhere else in the app —
 * they describe "trades you logged", never broker state, so they must never
 * block a feed row or an alert. For automated execution the calculus flips: we
 * are about to put an order on a broker, so a limit derived from imperfect data
 * failing closed is cheaper than an unbounded pile of live orders.
 */

export interface ExposureSnapshot {
  openRiskR: number;
  pendingRiskR: number;
  realizedLossTodayR: number;
}

export interface ExposureLimits {
  /** Combined open + pending initial risk, in R. */
  maxTotalRiskR: number;
  /** Realized loss closed today (UTC), in R, as a positive number. */
  maxDailyLossR: number;
}

export const EXECUTION_EXPOSURE_LIMITS: ExposureLimits = {
  maxTotalRiskR: 3,
  maxDailyLossR: 2,
};

export interface ExposureVerdict {
  allowed: boolean;
  detail: string | null;
}

export function evaluateExposure(
  snapshot: ExposureSnapshot,
  incomingRiskR = 1,
  limits: ExposureLimits = EXECUTION_EXPOSURE_LIMITS,
): ExposureVerdict {
  const total = snapshot.openRiskR + snapshot.pendingRiskR + incomingRiskR;
  if (total > limits.maxTotalRiskR) {
    return {
      allowed: false,
      detail: `open + pending risk would reach ${total.toFixed(2)}R (limit ${limits.maxTotalRiskR}R), based on trades you logged`,
    };
  }
  if (snapshot.realizedLossTodayR >= limits.maxDailyLossR) {
    return {
      allowed: false,
      detail: `today's logged realized loss is ${snapshot.realizedLossTodayR.toFixed(2)}R (limit ${limits.maxDailyLossR}R)`,
    };
  }
  return { allowed: true, detail: null };
}
