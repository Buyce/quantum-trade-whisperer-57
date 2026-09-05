/**
 * THE single sufficiency gate for P-Trades.
 *
 * Every surface (weekly email, admin panels, MCP tools) derives its verdict from
 * this module. Two gates cannot be kept consistent, so nothing else is allowed
 * to define "enough data".
 *
 * `actionable` additionally requires a genuine forward/out-of-sample holdout
 * confirmation. No holdout machinery is populated today, so `actionable` is
 * currently UNREACHABLE by construction — and that is the intended state.
 */
import { MIN_CLUSTERS } from "./bootstrap";

/**
 * NAMED TIERS — the only place a sufficiency floor may be defined.
 *
 * Different surfaces legitimately need different floors (a chronological
 * sub-period cannot carry as many independent days as all of history), but a
 * surface may NOT invent its own number: it names a tier here. `clusterUnit`
 * records what the cluster count actually counts, because an instrument-day is
 * a finer unit than a whole UTC day and the two floors are not comparable.
 */
export interface EvidenceTier {
  key: string;
  minSamples: number;
  minClusters: number;
  clusterUnit: "utc_day" | "instrument_day";
  note: string;
}

export const EVIDENCE_TIERS = {
  /** Read a verdict on a full history. The headline bar. */
  descriptive: {
    key: "descriptive",
    minSamples: 30,
    minClusters: MIN_CLUSTERS,
    clusterUnit: "utc_day",
    note: "Enough to describe a difference on full history.",
  },
  /**
   * One chronological sub-period of a split (train or holdout). Fewer whole days
   * are available by construction, so independence is counted per instrument-day.
   */
  chronological_period: {
    key: "chronological_period",
    minSamples: 30,
    minClusters: 5,
    clusterUnit: "instrument_day",
    note: "Enough to read one side of a chronological split.",
  },
  /** Enough to fit a model on, not merely to describe. */
  training: {
    key: "training",
    minSamples: 200,
    minClusters: MIN_CLUSTERS,
    clusterUnit: "utc_day",
    note: "Enough to train on, not merely to describe.",
  },
} as const satisfies Record<string, EvidenceTier>;

export type EvidenceTierKey = keyof typeof EVIDENCE_TIERS;

/** True when one group clears the named tier. Never partially credited. */
export function tierMet(tier: EvidenceTier, n: number, clusters: number): boolean {
  return n >= tier.minSamples && clusters >= tier.minClusters;
}

/** Minimum resolved observations per compared group. */
export const MIN_GROUP_SAMPLES = EVIDENCE_TIERS.descriptive.minSamples;

/** Minimum independent day clusters per compared group. */
export const MIN_GROUP_CLUSTERS = EVIDENCE_TIERS.descriptive.minClusters;

/** Smallest difference we would act on, in proportion points. */
export const PRACTICAL_EFFECT_THRESHOLD = 0.05;

export type EvidenceLevel = "insufficient" | "descriptive" | "suggestive" | "actionable";

export interface EvidenceInput {
  /** Observations in each compared group. */
  nA: number;
  nB: number;
  /** Independent UTC-day clusters in each compared group. */
  clustersA: number;
  clustersB: number;
  /** Absolute observed difference, same units for both groups. */
  observedEffect: number | null;
  /** Was this comparison predeclared in the experiment ledger? */
  predeclared: boolean;
  /** Was the required multiplicity control applied to a bounded family? */
  multiplicityControlled: boolean;
  /** Does a primary dependence-aware interval exclude no-effect? */
  intervalExcludesNull: boolean;
  /** Confirmed on a genuine forward / OOS / holdout sample? */
  holdoutConfirmed: boolean;
}

export interface EvidenceVerdict {
  level: EvidenceLevel;
  /** Reasons the verdict is not higher. Safe to render verbatim. */
  blockers: string[];
  note: string;
}

export function assessEvidence(input: EvidenceInput): EvidenceVerdict {
  const blockers: string[] = [];

  const enoughSamples = input.nA >= MIN_GROUP_SAMPLES && input.nB >= MIN_GROUP_SAMPLES;
  if (!enoughSamples) {
    blockers.push(
      `Not enough resolved observations: ${input.nA} vs ${input.nB} (need ${MIN_GROUP_SAMPLES} each).`,
    );
  }
  const enoughClusters =
    input.clustersA >= MIN_GROUP_CLUSTERS && input.clustersB >= MIN_GROUP_CLUSTERS;
  if (!enoughClusters) {
    blockers.push(
      `Not enough independent trading days: ${input.clustersA} vs ${input.clustersB} (need ${MIN_GROUP_CLUSTERS} each).`,
    );
  }

  if (!enoughSamples || !enoughClusters) {
    return {
      level: "insufficient",
      blockers,
      note: "No conclusion drawn. The sample cannot support one.",
    };
  }

  const practical =
    input.observedEffect != null && Math.abs(input.observedEffect) >= PRACTICAL_EFFECT_THRESHOLD;
  if (!practical) {
    blockers.push(
      `Observed difference is below the practical threshold of ${PRACTICAL_EFFECT_THRESHOLD}.`,
    );
  }
  if (!input.predeclared) blockers.push("Comparison was not predeclared in the experiment ledger.");
  if (!input.multiplicityControlled) {
    blockers.push("Required multiplicity control was not applied to a bounded family.");
  }
  if (!input.intervalExcludesNull) {
    blockers.push("The dependence-aware interval does not exclude no-effect.");
  }
  if (!input.holdoutConfirmed) {
    blockers.push("No genuine forward/out-of-sample holdout confirmation exists.");
  }

  if (blockers.length === 0) {
    return {
      level: "actionable",
      blockers,
      note: "Predeclared, multiplicity-controlled, day-clustered and holdout-confirmed.",
    };
  }

  const onlyHoldoutMissing =
    blockers.length === 1 && blockers[0]!.startsWith("No genuine forward/out-of-sample");
  if (onlyHoldoutMissing) {
    return {
      level: "suggestive",
      blockers,
      note: "Suggestive only. Not actionable without holdout confirmation.",
    };
  }

  return {
    level: "descriptive",
    blockers,
    note: "Descriptive only. Read as a diagnostic, not as a decision rule.",
  };
}

/** True when a compared pair clears the sufficiency floor. */
export function isSufficient(input: {
  nA: number;
  nB: number;
  clustersA: number;
  clustersB: number;
}): boolean {
  return (
    input.nA >= MIN_GROUP_SAMPLES &&
    input.nB >= MIN_GROUP_SAMPLES &&
    input.clustersA >= MIN_GROUP_CLUSTERS &&
    input.clustersB >= MIN_GROUP_CLUSTERS
  );
}

/**
 * Holdout confirmation is machinery, not a claim. Until a real forward sample is
 * accumulated and registered, this returns false for every input.
 */
export const HOLDOUT_AVAILABLE = false;

export function holdoutConfirmed(): boolean {
  return HOLDOUT_AVAILABLE;
}
