/**
 * Q-Core v1 — shadow-only quant decision contract.
 *
 * IMPORTANT: these state weights are NOT calibrated probabilities and MUST NOT
 * be used to submit, resize, cancel, or modify broker orders. Q-Core v1 exists
 * to create a stable research feature vector that can later be calibrated
 * against forward outcomes.
 */
export type QDirection = "long" | "short";
export type QState = "long" | "neutral" | "short";

export interface QCoreInput {
  direction: QDirection;
  /** Existing deterministic scanner pillars, each 0..100. */
  trend: number;
  orderBlock: number;
  momentum: number;
  volatilityExpansion: number;
  /** Planned reward/risk. Null means not measurable. */
  rr: number | null;
  /** Structural headroom in R. Null means not measurable. */
  maxR: number | null;
  /**
   * Descriptive historical rate from the existing regime engine. It may only
   * contribute when the caller proves the reporting gate is active.
   */
  regimeWinRate: number | null;
  regimeActive: boolean;
  /**
   * Execution quality 0..100 from recorded broker facts. Null means unmeasured.
   * It is deliberately a confidence dampener, not a directional signal.
   */
  executionQuality: number | null;
}

export interface QCoreFactor {
  name: "trend" | "structure" | "momentum" | "volatility" | "payoff" | "regime";
  signedEvidence: number;
  weight: number;
  contribution: number;
  measured: boolean;
}

export interface QCoreDecision {
  version: 1;
  mode: "shadow";
  state: QState;
  /** 0..1 ensemble certainty. Research score, not a forecast probability. */
  confidence: number;
  /** Uncalibrated state weights that sum to 1. */
  stateWeights: Record<QState, number>;
  directionalScore: number;
  evidenceCoverage: number;
  executionDampener: number;
  factors: QCoreFactor[];
  reasons: string[];
  /** Hard invariant for consumers and tests. */
  executionEligible: false;
}
