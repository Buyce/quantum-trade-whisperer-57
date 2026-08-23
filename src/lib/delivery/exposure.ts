/**
 * Exposure limits derived from the user's own trade journal.
 *
 * These numbers describe "trades you logged" — never broker state. P-Trades has
 * no read access to a broker account, so an ABSENT journal record is not proof
 * of zero exposure, and a self-reported figure is not authority to refuse an
 * order the user asked for. Therefore the limit is ADVISORY BY DEFAULT: it is
 * shown and logged, and it only blocks automated execution after the user has
 * explicitly opted in (`exposure_limit_enabled`).
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

/** Every exposure message must carry this provenance, verbatim. */
export const EXPOSURE_BASIS_COPY = "trades you logged";

export interface ExposureVerdict {
  /** True when the thresholds are exceeded, regardless of enforcement. */
  exceeded: boolean;
  /** False ONLY when the user opted in AND the thresholds are exceeded. */
  allowed: boolean;
  /** Whether the user opted into blocking on this advisory. */
  enforced: boolean;
  detail: string | null;
}

export interface ExposureOptions {
  /** Explicit user opt-in stored in settings. Defaults to advisory-only. */
  enforce?: boolean;
  limits?: ExposureLimits;
}

export function evaluateExposure(
  snapshot: ExposureSnapshot,
  incomingRiskR = 1,
  options: ExposureOptions = {},
): ExposureVerdict {
  const enforced = options.enforce === true;
  const limits = options.limits ?? EXECUTION_EXPOSURE_LIMITS;
  const total = snapshot.openRiskR + snapshot.pendingRiskR + incomingRiskR;

  let detail: string | null = null;
  if (total > limits.maxTotalRiskR) {
    detail = `open + pending risk would reach ${total.toFixed(2)}R (limit ${limits.maxTotalRiskR}R), based on ${EXPOSURE_BASIS_COPY} — this is not broker-account exposure`;
  } else if (snapshot.realizedLossTodayR >= limits.maxDailyLossR) {
    detail = `today's realized loss is ${snapshot.realizedLossTodayR.toFixed(2)}R (limit ${limits.maxDailyLossR}R), based on ${EXPOSURE_BASIS_COPY} — this is not broker-account exposure`;
  }

  const exceeded = detail !== null;
  return { exceeded, allowed: !(exceeded && enforced), enforced, detail };
}
