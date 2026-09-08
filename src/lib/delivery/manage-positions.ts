/**
 * Managed-exit decisions — pure, no I/O and no clock.
 *
 * Two policies act on a position AFTER it fills:
 *
 *  - `partial_tp1_runner_tp2`: close part of the position at the first target,
 *    move the remaining stop to the fill price (break-even), let the rest run to
 *    the submitted second target.
 *  - `ladder_tp1_tp2_runner_tp3`: the same first two steps, then close another
 *    part once the second target is reached and move the remaining stop up to the
 *    first target, so the runner to the third target can no longer lose money.
 *    An optional trail keeps the final runner's stop one risk unit behind the
 *    best price the broker has actually printed.
 *
 * This module decides WHICH single step is due right now, from broker facts only.
 *
 * Truthfulness rules encoded here:
 *  - A missing broker fact (no fill price, no current price, no volume, no volume
 *    step, no target, no risk distance) never produces an action. It produces
 *    "not decidable", and the caller records that instead of acting on a guess.
 *  - Every partial size is a share of the ORIGINAL filled volume, rounded DOWN to
 *    the broker's volume step, and refused when either side of the split would
 *    fall under the broker's minimum volume.
 *  - Reaching a target is judged from the broker's own current price, in the
 *    direction of the trade. Nothing is inferred from time or from the plan.
 *  - A stop is never moved backwards, and steps are strictly ordered: a later
 *    step is only considered once the earlier one is CONFIRMED by the broker.
 */
import { EXIT_SHARE_PRESETS, type ExitSharePreset } from "./execution";

export type PositionSide = "long" | "short";

export type ManagedStep =
  | "partial_1"
  | "stop_to_entry"
  | "partial_2"
  | "stop_to_first_target"
  | "trail";

export interface ManagedPositionFacts {
  side: PositionSide;
  /** Broker fill price of the position. Break-even sits exactly here. */
  openPrice: number | null;
  /** Broker's current price for the position. */
  currentPrice: number | null;
  /** Volume still open at the broker. */
  volume: number | null;
  /** Volume the broker originally filled, when known. Shares are taken of this. */
  originalVolume?: number | null;
  /** The published first target this policy takes the first partial at. */
  firstTarget: number | null;
  /** The published second target, needed by the laddered policy only. */
  secondTarget?: number | null;
  /** Distance from fill price to the original stop (one risk unit), for the trail. */
  riskDistance?: number | null;
  /** Best price the broker has printed for this position, for the trail. */
  bestPrice?: number | null;
  /** Broker volume step and minimum, from the symbol specification. */
  volumeStep: number | null;
  minVolume: number | null;
  /** Stop currently attached at the broker, when known. */
  currentStop: number | null;
}

/** Which managed steps the broker has already CONFIRMED. */
export interface ManagedProgress {
  partialDone: boolean;
  stopMoved: boolean;
  secondPartialDone: boolean;
  runnerStopMoved: boolean;
}

/** The active managed rule: which policy, what split, and whether to trail. */
export interface ManagedPlan {
  laddered: boolean;
  shares: readonly [number, number, number];
  trailRunner: boolean;
}

export interface ManagedPositionDecision {
  /** Which step this decision is about, or null when nothing is due. */
  step: ManagedStep | null;
  /** Close this volume at market now, or null when no partial is due. */
  closeVolume: number | null;
  /** Move the stop to this price now, or null when no move is due. */
  moveStopTo: number | null;
  /**
   * Why nothing is due, in plain words. Present whenever an action is withheld,
   * including when the facts are simply not there yet.
   */
  reason: string | null;
  /** True when a broker fact needed for the decision is missing or unusable. */
  undecidable: boolean;
}

const finite = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Rounds down to a whole number of volume steps, in step units to avoid drift. */
export function roundDownToStep(volume: number, step: number): number {
  if (!(step > 0)) return 0;
  const steps = Math.floor(volume / step + 1e-9);
  return Number((steps * step).toFixed(8));
}

const hold = (reason: string): ManagedPositionDecision => ({
  step: null,
  closeVolume: null,
  moveStopTo: null,
  reason,
  undecidable: false,
});

const unknown = (reason: string): ManagedPositionDecision => ({
  step: null,
  closeVolume: null,
  moveStopTo: null,
  reason,
  undecidable: true,
});

const close = (step: ManagedStep, volume: number): ManagedPositionDecision => ({
  step,
  closeVolume: volume,
  moveStopTo: null,
  reason: null,
  undecidable: false,
});

const move = (step: ManagedStep, price: number): ManagedPositionDecision => ({
  step,
  closeVolume: null,
  moveStopTo: price,
  reason: null,
  undecidable: false,
});

/** The plan for a policy plus its chosen share preset. */
export function managedPlan(policy: string, preset: ExitSharePreset): ManagedPlan {
  const laddered = policy === "ladder_tp1_tp2_runner_tp3";
  const shares = EXIT_SHARE_PRESETS[preset] ?? EXIT_SHARE_PRESETS.half_runner;
  return { laddered, shares, trailRunner: false };
}

/** True when the broker's current price has reached `target` in the trade's direction. */
const reached = (side: PositionSide, current: number, target: number): boolean =>
  side === "long" ? current >= target : current <= target;

/**
 * Decides the share to close at one rung, or a plain reason it is withheld.
 * Returns a decision either way so the caller never has to guess.
 */
function partialFor(
  facts: ManagedPositionFacts,
  step: ManagedStep,
  share: number,
  target: number | null,
  targetLabel: string,
): ManagedPositionDecision {
  const current = finite(facts.currentPrice);
  const volume = finite(facts.volume);
  const original = finite(facts.originalVolume) ?? volume;
  const stepSize = finite(facts.volumeStep);
  const min = finite(facts.minVolume);

  if (target === null) {
    return unknown(`The setup publishes no ${targetLabel} target to take a partial at.`);
  }
  if (current === null) return unknown("The broker reported no current price.");
  if (volume === null || volume <= 0 || original === null || original <= 0) {
    return unknown("The broker reported no open volume.");
  }
  if (stepSize === null || stepSize <= 0) {
    return unknown("The broker's volume step for this symbol is unknown.");
  }
  if (!reached(facts.side, current, target)) {
    return hold(`The ${targetLabel} target has not been reached yet.`);
  }

  const part = roundDownToStep(original * share, stepSize);
  if (part <= 0) return hold("This share of the position is smaller than the broker's volume step.");
  if (part >= volume) {
    return hold("Closing this share would close the whole position, so it is left to run.");
  }
  const remainder = Number((volume - part).toFixed(8));
  if (min !== null && (part < min || remainder < min)) {
    return hold("The broker's minimum volume does not allow this position to be split.");
  }
  return close(step, part);
}

/**
 * What (if anything) to do with a managed position right now.
 *
 * Each `progress` flag says whether that step has already been CONFIRMED. While
 * a step is merely attempted or unknown, no action is returned for it: repeating
 * a close that may have succeeded could shut the runner down.
 */
export function decideManagedStep(
  facts: ManagedPositionFacts,
  progress: ManagedProgress,
  plan: ManagedPlan,
): ManagedPositionDecision {
  const open = finite(facts.openPrice);
  if (open === null) return unknown("The broker reported no fill price for this position.");

  const tp1 = finite(facts.firstTarget);
  const tp2 = finite(facts.secondTarget);

  // 1 — part out at the first target.
  if (!progress.partialDone) {
    return partialFor(facts, "partial_1", plan.shares[0], tp1, "first");
  }

  // 2 — protect the remainder at the fill price.
  if (!progress.stopMoved) {
    const stop = finite(facts.currentStop);
    if (stop !== null && reached(facts.side, stop, open)) {
      return hold("The remaining stop already sits at or beyond break-even.");
    }
    return move("stop_to_entry", open);
  }

  if (!plan.laddered) return hold("The partial exit and the break-even stop are both done.");

  // 3 — part out at the second target, when the split asks for it.
  if (plan.shares[1] > 0 && !progress.secondPartialDone) {
    return partialFor(facts, "partial_2", plan.shares[1], tp2, "second");
  }

  // 4 — lift the runner's stop to the first target once the second is reached.
  if (!progress.runnerStopMoved) {
    const current = finite(facts.currentPrice);
    if (tp1 === null) return unknown("The setup publishes no first target to lift the stop to.");
    if (tp2 === null) return unknown("The setup publishes no second target.");
    if (current === null) return unknown("The broker reported no current price.");
    if (!reached(facts.side, current, tp2)) {
      return hold("The second target has not been reached yet.");
    }
    const stop = finite(facts.currentStop);
    if (stop !== null && reached(facts.side, stop, tp1)) {
      return hold("The runner's stop already sits at or beyond the first target.");
    }
    return move("stop_to_first_target", tp1);
  }

  // 5 — optional trail behind the best price the broker has printed.
  if (plan.trailRunner) {
    const risk = finite(facts.riskDistance);
    const best = finite(facts.bestPrice);
    const current = finite(facts.currentPrice);
    if (risk === null || risk <= 0) {
      return unknown("The original risk distance for this position is unknown.");
    }
    if (best === null) return unknown("No best price has been recorded for this position yet.");
    if (current === null) return unknown("The broker reported no current price.");
    const candidate = Number((facts.side === "long" ? best - risk : best + risk).toFixed(8));
    if (reached(facts.side, candidate, current)) {
      return hold("A trailing stop there would sit at or beyond the current price.");
    }
    const stop = finite(facts.currentStop);
    if (stop !== null && reached(facts.side, stop, candidate)) {
      return hold("The trailing stop already sits at or beyond that price.");
    }
    return move("trail", candidate);
  }

  return hold("Every managed step for this position is done.");
}

/**
 * Two-step managed policy, kept as the narrow call the reconcile pass has always
 * made: half out at the first target, then the stop to break-even.
 */
export function decideManagedPosition(
  facts: ManagedPositionFacts,
  partialDone: boolean,
  stopMoved: boolean,
): ManagedPositionDecision {
  return decideManagedStep(
    facts,
    { partialDone, stopMoved, secondPartialDone: false, runnerStopMoved: false },
    { laddered: false, shares: EXIT_SHARE_PRESETS.half_runner, trailRunner: false },
  );
}
