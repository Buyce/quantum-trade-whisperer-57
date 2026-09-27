import type { QCoreFactor } from "./types";

export const QCORE_MODEL_VERSION = 5;
export const QCORE_ENGINE_VERSION = 3;
export const QCORE_FEATURE_SCHEMA_VERSION = 1;

/**
 * One immutable policy object is the upgrade seam for Q-Core. Future calibrated
 * weights can be introduced as a new policy/version without rewriting the
 * scanner or silently changing historical observations.
 */
export interface QCorePolicy {
  id: string;
  engineVersion: number;
  featureSchemaVersion: number;
  factorWeights: Record<QCoreFactor["name"], number>;
  stateTemperature: number;
  neutralStrength: number;
  minCoverage: number;
}

export const QCORE_POLICY_V2: Readonly<QCorePolicy> = Object.freeze({
  id: "qcore_v3_hypothesis_scoped_20260927",
  engineVersion: QCORE_ENGINE_VERSION,
  featureSchemaVersion: QCORE_FEATURE_SCHEMA_VERSION,
  factorWeights: {
    trend: 0.26,
    structure: 0.2,
    momentum: 0.16,
    volatility: 0.12,
    payoff: 0.16,
    regime: 0.1,
  },
  stateTemperature: 2.4,
  neutralStrength: 1.25,
  minCoverage: 0.55,
});
