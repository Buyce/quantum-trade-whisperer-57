import { QCORE_POLICY_V2, type QCorePolicy } from "./config";
import type { QCoreDecision, QCoreFactor, QCoreInput, QState } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round = (v: number, d = 4) => Number(v.toFixed(d));

/** Maps a bounded 0..100 feature onto symmetric evidence -1..+1. */
function centered(v: number): number {
  return clamp((clamp(v, 0, 100) - 50) / 50, -1, 1);
}

/**
 * Smooth payoff evidence. 1R is neutral; 3R is strong positive evidence.
 * A missing payoff is unmeasured rather than silently treated as average.
 */
function payoffEvidence(rr: number | null, maxR: number | null): number | null {
  if (!finite(rr) || !finite(maxR) || rr < 0 || maxR < 0) return null;
  const reachable = Math.min(rr, maxR);
  return clamp((reachable - 1) / 2, -1, 1);
}

function regimeEvidence(rate: number | null, active: boolean): number | null {
  if (!active || !finite(rate)) return null;
  return clamp((clamp(rate, 0, 1) - 0.5) * 2, -1, 1);
}

function softmax3(longLogit: number, neutralLogit: number, shortLogit: number) {
  const m = Math.max(longLogit, neutralLogit, shortLogit);
  const a = Math.exp(longLogit - m);
  const b = Math.exp(neutralLogit - m);
  const c = Math.exp(shortLogit - m);
  const z = a + b + c;
  return { long: a / z, neutral: b / z, short: c / z };
}

/**
 * Q-Core v1 is intentionally pure and shadow-only.
 *
 * Direction is supplied by the existing scanner. The ensemble measures how
 * strongly independent evidence supports or contradicts that hypothesis.
 * Nothing here can authorize execution.
 */
export function evaluateQCore(
  input: QCoreInput,
  policy: QCorePolicy = QCORE_POLICY_V2,
): QCoreDecision {
  const sign = input.direction === "long" ? 1 : -1;
  const raw: Array<[QCoreFactor["name"], number | null, number]> = [
    ["trend", finite(input.trend) ? centered(input.trend) : null, policy.factorWeights.trend],
    [
      "structure",
      finite(input.orderBlock) ? centered(input.orderBlock) : null,
      policy.factorWeights.structure,
    ],
    [
      "momentum",
      finite(input.momentum) ? centered(input.momentum) : null,
      policy.factorWeights.momentum,
    ],
    [
      "volatility",
      finite(input.volatilityExpansion) ? centered(input.volatilityExpansion) : null,
      policy.factorWeights.volatility,
    ],
    ["payoff", payoffEvidence(input.rr, input.maxR), policy.factorWeights.payoff],
    [
      "regime",
      regimeEvidence(input.regimeWinRate, input.regimeActive),
      policy.factorWeights.regime,
    ],
  ];

  const measuredWeight = raw.reduce((s, [, value, weight]) => s + (value == null ? 0 : weight), 0);
  const factors: QCoreFactor[] = raw.map(([name, value, weight]) => {
    const measured = value != null;
    const normalizedWeight = measuredWeight > 0 && measured ? weight / measuredWeight : 0;
    const signedEvidence = measured ? value * sign : 0;
    return {
      name,
      signedEvidence: round(signedEvidence),
      weight: round(normalizedWeight),
      contribution: round(signedEvidence * normalizedWeight),
      measured,
    };
  });

  const directionalScore = clamp(
    factors.reduce((s, f) => s + f.contribution, 0),
    -1,
    1,
  );
  const evidenceCoverage = clamp(measuredWeight, 0, 1);
  const coverageSufficient = evidenceCoverage >= policy.minCoverage;

  // Evidence is scoped to the scanner's supplied hypothesis. Contradictory or
  // weak evidence may reject that hypothesis into neutral, but cannot manufacture
  // the opposite market state; that direction must be evaluated independently.
  const hypothesisSupport = directionalScore * sign;
  const supported = Math.max(0, hypothesisSupport) * evidenceCoverage;
  const hypothesisLogit = supported * policy.stateTemperature;
  const neutralLogit = (1 - supported) * policy.neutralStrength;
  const oppositeLogit = -policy.neutralStrength;
  const rawStateWeights =
    input.direction === "long"
      ? softmax3(hypothesisLogit, neutralLogit, oppositeLogit)
      : softmax3(oppositeLogit, neutralLogit, hypothesisLogit);

  // Execution quality is a confidence-only dampener. Mix the ensemble toward a
  // uniform distribution so poorer quality can never increase the winning
  // confidence or create direction. Missing quality remains visibly unmeasured.
  const executionDampener = finite(input.executionQuality)
    ? 0.5 + (0.5 * clamp(input.executionQuality, 0, 100)) / 100
    : 1;
  const uniform = 1 / 3;
  const stateWeights = {
    long: uniform + executionDampener * (rawStateWeights.long - uniform),
    neutral: uniform + executionDampener * (rawStateWeights.neutral - uniform),
    short: uniform + executionDampener * (rawStateWeights.short - uniform),
  };
  const entries = Object.entries(stateWeights) as Array<[QState, number]>;
  entries.sort((a, b) => b[1] - a[1]);
  const state = entries[0]![0];
  const confidence = entries[0]![1];

  const reasons = [
    `qcore_v${policy.engineVersion}_shadow_only`,
    `policy=${policy.id}`,
    `feature_schema=${policy.featureSchemaVersion}`,
    `coverage_gate=${coverageSufficient ? "sufficient" : "insufficient"}`,
    `coverage=${round(evidenceCoverage)}`,
    `directional_score=${round(directionalScore)}`,
    input.regimeActive ? "regime_reporting_gate=active" : "regime_reporting_gate=inactive",
    finite(input.executionQuality)
      ? `execution_quality=${round(input.executionQuality, 1)}`
      : "execution_quality=unmeasured",
  ];

  return {
    version: policy.engineVersion,
    policyId: policy.id,
    featureSchemaVersion: policy.featureSchemaVersion,
    mode: "shadow",
    state,
    confidence: round(confidence),
    stateWeights: {
      long: round(stateWeights.long),
      neutral: round(stateWeights.neutral),
      short: round(stateWeights.short),
    },
    directionalScore: round(directionalScore),
    evidenceCoverage: round(evidenceCoverage),
    coverageSufficient,
    executionDampener: round(executionDampener),
    factors,
    reasons,
    executionEligible: false,
  };
}
