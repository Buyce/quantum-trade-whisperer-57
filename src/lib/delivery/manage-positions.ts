/**
 * Managed-exit decisions — pure, no I/O and no clock.
 *
 * The managed policy (`partial_tp1_runner_tp2`) is the only policy that acts on a
 * position AFTER it fills: part of it is closed at the first target and the
 * remaining stop is moved to the fill price (break-even). This module decides
 * WHETHER each of those two actions is due, from broker facts only.
 *
 * Truthfulness rules encoded here:
 *  - A missing broker fact (no fill price, no volume, no volume step, no first
 *    target) never produces an action. It produces "not decidable", and the
 *    caller records that instead of acting on a guess.
 *  - The partial size is rounded DOWN to the broker's volume step and refused
 *    when the remainder would fall under the broker's minimum volume: closing
 *    "about half" of a position the broker cannot actually split would either
 *    fail or close the runner.
 *  - Reaching the first target is judged from the broker's own current price, in
 *    the direction of the trade. Nothing is inferred from time or from the plan.
 */

export type PositionSide = "long" | "short";

export interface ManagedPositionFacts {
  side: PositionSide;
  /** Broker fill price of the position. Break-even sits exactly here. */
  openPrice: number | null;
  /** Broker's current price for the position. */
  currentPrice: number | null;
  /** Volume still open at the broker. */
  volume: number | null;
  /** The published first target this policy takes the partial at. */
  firstTarget: number | null;
  /** Broker volume step and minimum, from the symbol specification. */
  volumeStep: number | null;
  minVolume: number | null;
  /** Stop currently attached at the broker, when known. */
  currentStop: number | null;
}

export interface ManagedPositionDecision {
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
  closeVolume: null,
  moveStopTo: null,
  reason,
  undecidable: false,
});

const unknown = (reason: string): ManagedPositionDecision => ({
  closeVolume: null,
  moveStopTo: null,
  reason,
  undecidable: true,
});

/**
 * What (if anything) to do with a managed position right now.
 *
 * `partialDone` says whether the partial close has already been CONFIRMED. While
 * it is merely attempted or unknown, this returns no partial action: repeating a
 * close that may have succeeded could shut the runner down.
 */
export function decideManagedPosition(
  facts: ManagedPositionFacts,
  partialDone: boolean,
  stopMoved: boolean,
): ManagedPositionDecision {
  const open = finite(facts.openPrice);
  const current = finite(facts.currentPrice);
  const tp1 = finite(facts.firstTarget);
  const volume = finite(facts.volume);
  const step = finite(facts.volumeStep);
  const min = finite(facts.minVolume);

  if (open === null) return unknown("The broker reported no fill price for this position.");

  if (!partialDone) {
    if (tp1 === null) return unknown("The setup publishes no first target to take a partial at.");
    if (current === null) return unknown("The broker reported no current price.");
    if (volume === null || volume <= 0) return unknown("The broker reported no open volume.");
    if (step === null || step <= 0) {
      return unknown("The broker's volume step for this symbol is unknown.");
    }
    const reached = facts.side === "long" ? current >= tp1 : current <= tp1;
    if (!reached) return hold("The first target has not been reached yet.");

    const half = roundDownToStep(volume / 2, step);
    if (half <= 0) return hold("Half this position is smaller than the broker's volume step.");
    const remainder = Number((volume - half).toFixed(8));
    if (min !== null && (half < min || remainder < min)) {
      return hold("The broker's minimum volume does not allow this position to be split.");
    }
    return { closeVolume: half, moveStopTo: null, reason: null, undecidable: false };
  }

  if (!stopMoved) {
    const stop = finite(facts.currentStop);
    // Already at (or better than) break-even: nothing to do, and never move a
    // stop backwards.
    if (stop !== null && (facts.side === "long" ? stop >= open : stop <= open)) {
      return hold("The remaining stop already sits at or beyond break-even.");
    }
    return { closeVolume: null, moveStopTo: open, reason: null, undecidable: false };
  }

  return hold("The partial exit and the break-even stop are both done.");
}
