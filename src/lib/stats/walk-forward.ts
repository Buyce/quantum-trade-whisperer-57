/**
 * Walk-forward (time-split) confirmation — pure, no I/O, no clock.
 *
 * A gate difference measured on all of history is in-sample by construction: the
 * same days that produced the difference also decided that it exists. This
 * module answers the only question that makes a threshold change defensible:
 * does the difference still hold on a LATER period the earlier period could not
 * see?
 *
 * The split is chronological by UTC trading day — never random — so no
 * observation from the holdout period can influence the training period.
 *
 * Zero-hallucination rules:
 *  - A period thin on samples or independent days is reported as not decidable,
 *    with the missing floor named. It is never rounded up into a confirmation.
 *  - Intervals are cluster-robust (instrument-day clusters), because overlapping
 *    setups on one instrument-day are not independent.
 *  - An unmeasured or undecidable result is `confirmed: false` and never
 *    `confirmed: true` by default. Failing to measure can only withhold a
 *    change, never authorise one.
 */

import { EVIDENCE_TIERS } from "./evidence";

/**
 * Floors come from the shared `chronological_period` tier — this module does not
 * define its own bar. Independence is counted per instrument-day, which is what
 * that tier declares.
 */
const PERIOD_TIER = EVIDENCE_TIERS.chronological_period;

/** Minimum resolved observations each arm needs, in EACH period. */
export const MIN_PERIOD_SAMPLES = PERIOD_TIER.minSamples;
/** Minimum independent instrument-day clusters each arm needs, in each period. */
export const MIN_PERIOD_CLUSTERS = PERIOD_TIER.minClusters;

/** Smallest mean-R difference in the holdout period worth acting on. */
export const MIN_HOLDOUT_EFFECT = 0.05;
/** Share of the measured trading days used for training; the rest is holdout. */
export const TRAIN_FRACTION = 0.7;

const Z = 1.96;

export interface WalkForwardObservation {
  /** UTC trading day, `YYYY-MM-DD`. */
  day: string;
  /** Independence unit, normally `day|instrument`. */
  cluster: string;
  arm: "pass" | "fail";
  /** Realised research R for this observation. */
  r: number;
}

export interface WalkForwardArm {
  n: number;
  clusters: number;
  meanR: number | null;
  /** Cluster-robust standard error of the mean; null when not computable. */
  seR: number | null;
}

export interface WalkForwardPeriod {
  firstDay: string;
  lastDay: string;
  days: number;
  pass: WalkForwardArm;
  fail: WalkForwardArm;
  /** Fail minus pass, matching the filter-lift convention. */
  deltaR: number | null;
  low: number | null;
  high: number | null;
}

export interface WalkForwardResult {
  confirmed: boolean;
  /** First day of the holdout period; null when no split was possible. */
  splitDay: string | null;
  train: WalkForwardPeriod | null;
  holdout: WalkForwardPeriod | null;
  /** Reasons the result is not a confirmation. Safe to render verbatim. */
  blockers: string[];
  detail: string;
}

const EMPTY_ARM: WalkForwardArm = { n: 0, clusters: 0, meanR: null, seR: null };

function armStats(rows: WalkForwardObservation[]): WalkForwardArm {
  const usable = rows.filter((r) => Number.isFinite(r.r));
  const n = usable.length;
  if (n === 0) return EMPTY_ARM;
  const mean = usable.reduce((s, r) => s + r.r, 0) / n;

  const totals = new Map<string, { n: number; total: number }>();
  for (const row of usable) {
    const c = totals.get(row.cluster) ?? { n: 0, total: 0 };
    c.n += 1;
    c.total += row.r;
    totals.set(row.cluster, c);
  }
  const clusters = totals.size;
  // Cluster-robust standard error of the mean: variability BETWEEN clusters,
  // not between individual observations.
  let ss = 0;
  for (const c of totals.values()) ss += (c.total - c.n * mean) ** 2;
  const seR =
    clusters > 1 ? Math.sqrt((ss * clusters) / (clusters - 1)) / n : null;
  return { n, clusters, meanR: mean, seR };
}

function periodStats(rows: WalkForwardObservation[]): WalkForwardPeriod {
  const days = [...new Set(rows.map((r) => r.day))].sort();
  const pass = armStats(rows.filter((r) => r.arm === "pass"));
  const fail = armStats(rows.filter((r) => r.arm === "fail"));
  const deltaR = pass.meanR === null || fail.meanR === null ? null : fail.meanR - pass.meanR;
  const se =
    pass.seR === null || fail.seR === null ? null : Math.sqrt(pass.seR ** 2 + fail.seR ** 2);
  return {
    firstDay: days[0] ?? "",
    lastDay: days[days.length - 1] ?? "",
    days: days.length,
    pass,
    fail,
    deltaR,
    low: deltaR === null || se === null ? null : deltaR - Z * se,
    high: deltaR === null || se === null ? null : deltaR + Z * se,
  };
}

function armBlockers(period: WalkForwardPeriod, label: string, blockers: string[]): void {
  for (const [arm, stats] of [
    ["pass", period.pass],
    ["fail", period.fail],
  ] as const) {
    if (stats.n < MIN_PERIOD_SAMPLES) {
      blockers.push(
        `${label} ${arm} arm has ${stats.n} resolved observations (needs ${MIN_PERIOD_SAMPLES}).`,
      );
    }
    if (stats.clusters < MIN_PERIOD_CLUSTERS) {
      blockers.push(
        `${label} ${arm} arm covers ${stats.clusters} independent instrument-days (needs ${MIN_PERIOD_CLUSTERS}).`,
      );
    }
  }
}

/**
 * Split the observations chronologically and report whether the earlier
 * period's difference is reproduced on the later, unseen one.
 */
export function evaluateWalkForward(
  observations: WalkForwardObservation[],
  options: { trainFraction?: number; minEffect?: number } = {},
): WalkForwardResult {
  const trainFraction = options.trainFraction ?? TRAIN_FRACTION;
  const minEffect = options.minEffect ?? MIN_HOLDOUT_EFFECT;

  const rows = observations.filter((o) => typeof o.day === "string" && o.day.length > 0);
  const days = [...new Set(rows.map((r) => r.day))].sort();
  if (days.length < 2) {
    return {
      confirmed: false,
      splitDay: null,
      train: null,
      holdout: null,
      blockers: [
        `Only ${days.length} measured trading day(s): a later, unseen period does not exist yet.`,
      ],
      detail: "No time split is possible, so nothing has been confirmed out of sample.",
    };
  }

  const cut = Math.min(Math.max(1, Math.floor(days.length * trainFraction)), days.length - 1);
  const splitDay = days[cut]!;
  const train = periodStats(rows.filter((r) => r.day < splitDay));
  const holdout = periodStats(rows.filter((r) => r.day >= splitDay));

  const blockers: string[] = [];
  armBlockers(train, "Training", blockers);
  armBlockers(holdout, "Holdout", blockers);

  if (blockers.length === 0) {
    if (train.deltaR === null || holdout.deltaR === null) {
      blockers.push("A period difference could not be computed from the stored outcomes.");
    } else {
      if (Math.sign(train.deltaR) !== Math.sign(holdout.deltaR)) {
        blockers.push(
          `The difference changes direction out of sample: ${train.deltaR.toFixed(3)}R in training against ${holdout.deltaR.toFixed(3)}R on the holdout.`,
        );
      }
      if (Math.abs(holdout.deltaR) < minEffect) {
        blockers.push(
          `The holdout difference of ${holdout.deltaR.toFixed(3)}R is below the ${minEffect}R threshold worth acting on.`,
        );
      }
      if (holdout.low === null || holdout.high === null) {
        blockers.push("The holdout interval could not be computed, so no-effect is not excluded.");
      } else if (holdout.low <= 0 && holdout.high >= 0) {
        blockers.push("The holdout interval includes no-effect.");
      }
    }
  }

  const confirmed = blockers.length === 0;
  return {
    confirmed,
    splitDay,
    train,
    holdout,
    blockers,
    detail: confirmed
      ? `Held up out of sample: ${holdout.deltaR!.toFixed(3)}R on ${holdout.days} unseen trading days from ${splitDay}, same direction as training.`
      : "Not confirmed out of sample. No threshold change may be proposed on this evidence.",
  };
}
