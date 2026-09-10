/**
 * Automatic stage advancement — the PURE rules.
 *
 * The lifecycle ladder was climbed by hand: a human read the promotion
 * checkpoint and typed a transition. This module encodes the same judgement so
 * it can run daily, and it is deliberately harder to satisfy than a human is,
 * because nobody reviews each step any more.
 *
 * Four principles, each of which the tests pin:
 *
 *  1. EVIDENCE OR NOTHING. Every input is nullable. `null` means "not measured",
 *     never "measured as fine": an unreadable input blocks the step. Nothing is
 *     inferred, defaulted or carried over from a previous day.
 *  2. ONE STEP PER DAY, NEVER SKIPPED. An instrument climbs
 *     data_validation -> shadow -> signals_only -> execution_approved one rung
 *     at a time, at most once per UTC day, so every rung is observed live for a
 *     full day before the next is considered.
 *  3. THIS MODULE ONLY EVER MOVES AN INSTRUMENT FORWARD. Degrading evidence
 *     holds an instrument exactly where it is, with the reasons recorded; it
 *     never steps it back down. Moving an instrument to a lower stage is a
 *     human decision, taken through the audited transition path.
 *  4. `execution_approved` IS PERMISSION, NOT AN ORDER. It only means the
 *     lifecycle no longer blocks execution. The global live switch, each
 *     account's own settings, the risk brakes and the intelligence gate all still
 *     apply, and this module never touches any of them.
 */
import type { InstrumentStage } from "./lifecycle";
import type { PromotionVerdict } from "./promotion";

/** The rungs automatic advancement may move between, in order. */
export const LADDER: InstrumentStage[] = [
  "data_validation",
  "shadow",
  "signals_only",
  "execution_approved",
];

/**
 * Resolved-outcome evidence for one instrument at one measurement stage.
 *
 * `clusters` counts whole UTC days, matching the project's dependence unit: 40
 * outcomes from two days is not 40 independent observations.
 */
export interface OutcomeEvidence {
  samples: number;
  clusters: number;
  /** Full-payoff expected R. Never a win rate. */
  expectedR: number | null;
  /** Cluster-bootstrap 95% interval on that mean. */
  ciLow: number | null;
  ciHigh: number | null;
}

/** Chronological holdout on the instrument's own later days. */
export interface HoldoutEvidence {
  splitDay: string | null;
  samples: number;
  clusters: number;
  meanR: number | null;
  ciLow: number | null;
}

export interface AdvancementEvidence {
  instrument: string;
  /** Current stage, or null when the lifecycle row could not be read. */
  stage: InstrumentStage | null;
  /** The existing data-quality gate. Reused verbatim for the first rung. */
  promotion: PromotionVerdict | null;
  /** Shadow (unpublished) resolved outcomes over the evidence window. */
  shadow: OutcomeEvidence | null;
  /** Published-signal resolved outcomes over the evidence window. */
  published: OutcomeEvidence | null;
  /** Chronological holdout on shadow outcomes. */
  holdout: HoldoutEvidence | null;
  /**
   * CURRENT readiness standing, not the whole month. A failure that has since
   * been repaired must not hold an instrument back for weeks.
   */
  readiness: ReadinessRecency | null;
  /** Latest measured sample missingness, percent. */
  missingnessPct: number | null;
  /** UTC day of this instrument's most recent automatic transition. */
  lastAutoTransitionDay: string | null;
}

export interface AdvancementVerdict {
  instrument: string;
  stage: InstrumentStage | null;
  action: "promote" | "hold";
  /** Destination for a promotion; null on hold. */
  target: InstrumentStage | null;
  /** Why the instrument is not being promoted. Renderable. */
  reasons: string[];
}

/** Sufficiency floors for the measurement rungs. */
export const MIN_OUTCOME_SAMPLES = 30;
export const MIN_OUTCOME_CLUSTERS = 10;
export const MIN_HOLDOUT_SAMPLES = 30;
export const MIN_HOLDOUT_CLUSTERS = 5;
/** Same ceiling the manual promotion gate uses. */
export const MAX_MISSINGNESS_PCT = 20;
/** Two not-ready snapshots in the window is a data problem, not a blip. */
export const MAX_READINESS_FAILURES = 1;

export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function stepUp(stage: InstrumentStage): InstrumentStage | null {
  const i = LADDER.indexOf(stage);
  return i >= 0 && i < LADDER.length - 1 ? (LADDER[i + 1] as InstrumentStage) : null;
}

/** Positive expectancy that a dependence-aware interval agrees with. */
function positiveExpectancy(e: OutcomeEvidence | null, label: string, reasons: string[]): boolean {
  if (!e) {
    reasons.push(`${label} outcomes are not readable, so no verdict can be drawn.`);
    return false;
  }
  let ok = true;
  if (e.samples < MIN_OUTCOME_SAMPLES) {
    reasons.push(`${label}: ${e.samples} resolved outcomes (needs ${MIN_OUTCOME_SAMPLES}).`);
    ok = false;
  }
  if (e.clusters < MIN_OUTCOME_CLUSTERS) {
    reasons.push(
      `${label}: ${e.clusters} independent trading days (needs ${MIN_OUTCOME_CLUSTERS}).`,
    );
    ok = false;
  }
  if (e.expectedR === null || e.ciLow === null) {
    reasons.push(`${label}: expected R could not be computed.`);
    ok = false;
  } else if (e.expectedR <= 0) {
    reasons.push(`${label}: expected R is ${e.expectedR.toFixed(3)}R, not positive.`);
    ok = false;
  } else if (e.ciLow <= 0) {
    reasons.push(
      `${label}: the confidence interval reaches ${e.ciLow.toFixed(3)}R, so the gain is not distinguishable from zero.`,
    );
    ok = false;
  }
  return ok;
}

/** Data-quality facts every rung above the first also depends on. */
function dataStillClean(e: AdvancementEvidence, reasons: string[]): boolean {
  let ok = true;
  if (e.missingnessPct === null) {
    reasons.push("Sample missingness is not measured.");
    ok = false;
  } else if (e.missingnessPct > MAX_MISSINGNESS_PCT) {
    reasons.push(
      `Sample missingness is ${e.missingnessPct.toFixed(1)}% (ceiling ${MAX_MISSINGNESS_PCT}%).`,
    );
    ok = false;
  }
  if (e.readinessFailures === null) {
    reasons.push("Readiness history is not readable.");
    ok = false;
  } else if (e.readinessFailures > MAX_READINESS_FAILURES) {
    reasons.push(
      `${e.readinessFailures} readiness checks failed in the window (allowed ${MAX_READINESS_FAILURES}).`,
    );
    ok = false;
  }
  return ok;
}

/**
 * Evidence that has degraded. These reasons BLOCK a promotion and are recorded
 * so a human can act on them; they never move the instrument down a stage.
 */
function degradedEvidenceReasons(e: AdvancementEvidence, stage: InstrumentStage): string[] {
  const reasons: string[] = [];

  if (e.missingnessPct !== null && e.missingnessPct > MAX_MISSINGNESS_PCT) {
    reasons.push(
      `Sample missingness rose to ${e.missingnessPct.toFixed(1)}% (ceiling ${MAX_MISSINGNESS_PCT}%).`,
    );
  }
  if (e.readinessFailures !== null && e.readinessFailures > MAX_READINESS_FAILURES) {
    reasons.push(`${e.readinessFailures} readiness checks failed in the window.`);
  }

  // Expectancy that has turned convincingly negative. A merely uncertain result
  // holds the instrument where it is; the interval has to sit BELOW zero.
  const measured = stage === "execution_approved" || stage === "signals_only" ? e.published : null;
  for (const [label, ev] of [
    ["Published outcomes", measured],
    ["Shadow outcomes", e.shadow],
  ] as const) {
    if (
      ev &&
      ev.samples >= MIN_OUTCOME_SAMPLES &&
      ev.clusters >= MIN_OUTCOME_CLUSTERS &&
      ev.ciHigh !== null &&
      ev.ciHigh < 0
    ) {
      reasons.push(`${label}: expectancy is negative across the whole confidence interval.`);
    }
  }
  return reasons;
}

export function evaluateAdvancement(e: AdvancementEvidence, now: Date): AdvancementVerdict {
  const hold = (reasons: string[]): AdvancementVerdict => ({
    instrument: e.instrument,
    stage: e.stage,
    action: "hold",
    target: null,
    reasons,
  });

  // FAIL CLOSED: an unreadable stage is never assumed.
  if (e.stage === null) {
    return hold(["The instrument's stage could not be read, so nothing is changed."]);
  }
  // Emergency and off states are human territory only.
  if (!LADDER.includes(e.stage)) {
    return hold([`Stage ${e.stage} is not on the automatic ladder.`]);
  }

  // Degraded evidence holds the instrument exactly where it is. Only a human may
  // move an instrument to a lower stage.
  const degraded = degradedEvidenceReasons(e, e.stage);
  if (degraded.length > 0) return hold(degraded);

  const today = utcDay(now);
  if (e.lastAutoTransitionDay === today) {
    return hold(["This instrument already moved a stage today; one step per day."]);
  }

  const target = stepUp(e.stage);
  if (!target) return hold(["Already at the top of the automatic ladder."]);

  const reasons: string[] = [];

  if (e.stage === "data_validation") {
    // Rung 1 reuses the existing data-quality checkpoint verbatim.
    if (!e.promotion) reasons.push("The promotion checkpoint produced no verdict.");
    else if (!e.promotion.promotable) reasons.push(...e.promotion.reasons);
  }

  if (e.stage === "shadow") {
    dataStillClean(e, reasons);
    positiveExpectancy(e.shadow, "Shadow outcomes", reasons);
  }

  if (e.stage === "signals_only") {
    dataStillClean(e, reasons);
    positiveExpectancy(e.shadow, "Shadow outcomes", reasons);
    positiveExpectancy(e.published, "Published outcomes", reasons);

    if (!e.holdout) {
      reasons.push("No chronological holdout could be formed.");
    } else if (
      e.holdout.samples < MIN_HOLDOUT_SAMPLES ||
      e.holdout.clusters < MIN_HOLDOUT_CLUSTERS
    ) {
      reasons.push(
        `Holdout period has ${e.holdout.samples} outcomes over ${e.holdout.clusters} days (needs ${MIN_HOLDOUT_SAMPLES} over ${MIN_HOLDOUT_CLUSTERS}).`,
      );
    } else if (e.holdout.ciLow === null || e.holdout.ciLow <= 0) {
      reasons.push("The later holdout period does not confirm positive expected R.");
    }
  }

  if (reasons.length > 0) return hold(reasons);

  return {
    instrument: e.instrument,
    stage: e.stage,
    action: "promote",
    target,
    reasons: [],
  };
}
