/**
 * Exit-variant simulation — pure, research only, no I/O and no clock.
 *
 * The live policy is `single_exit_first_target`: one order, stop attached, exit
 * at the first target. That is safe and measurable, but it cannot answer whether
 * a partial exit with a runner, a break-even move or a trailing stop would have
 * paid more, because two summary numbers (best and worst excursion) do not
 * record the ORDER of events. This module answers that question from the ordered
 * post-fill path Replay V2 records.
 *
 * Coordinates: everything is in R against the ACTUAL filled risk, measured from
 * the fill price. A bar contributes `hR` (its high, in R) and `lR` (its adverse
 * excursion, in R — so the bar's low sits at `-lR`). The initial stop is at -1R
 * by construction of the risk unit.
 *
 * Zero-hallucination rules:
 *  - A bar whose internal order cannot be established (`amb`), or a bar in which
 *    a variant's favourable AND adverse barriers are both crossed, makes the
 *    setup UNDECIDABLE for that variant: excluded from that variant's sample,
 *    never resolved in the platform's favour and never against it either.
 *  - A path that ends with the position still open is undecidable: the record
 *    carries no closing price, so a mark-to-close cannot be invented.
 *  - Ladder levels the plan does not define are absent, not assumed.
 *  - Every variant is simulated against the SAME path as the baseline, so the
 *    comparison is like-for-like by construction.
 */
import type { PathBar } from "./replay-v2";

export const EXIT_VARIANTS = [
  "single_exit_first_target",
  "partial_tp1_runner_tp2",
  "partial_tp1_runner_tp3",
  "breakeven_after_1r",
  "trail_1r",
] as const;

export type ExitVariant = (typeof EXIT_VARIANTS)[number];

/** The baseline every variant is measured against. */
export const BASELINE_VARIANT: ExitVariant = "single_exit_first_target";

export const EXIT_VARIANT_LABELS: Record<ExitVariant, string> = {
  single_exit_first_target: "Single exit at first target (current policy)",
  partial_tp1_runner_tp2: "Half out at first target, rest to second (stop to break-even)",
  partial_tp1_runner_tp3: "Half out at first target, rest to third (stop to break-even)",
  breakeven_after_1r: "Stop to break-even after 1R, then exit at first target",
  trail_1r: "Trailing stop 1R behind the best excursion",
};

export interface ExitPath {
  bars: PathBar[];
  /** [tp1, tp2, tp3] in R against the filled risk; null when not defined. */
  targetsR: [number | null, number | null, number | null];
  /** True when the bar cap was reached, so the tail of the path is unknown. */
  truncated: boolean;
}

export interface VariantOutcome {
  decidable: boolean;
  /** Realised R under this variant. Null whenever it is not decidable. */
  r: number | null;
  /** Plain reason a setup is undecidable. Safe to render verbatim. */
  reason: string | null;
}

const undecidable = (reason: string): VariantOutcome => ({ decidable: false, r: null, reason });
const decided = (r: number): VariantOutcome => ({
  decidable: true,
  r: Number(r.toFixed(4)),
  reason: null,
});

const AMBIGUOUS_BAR = "A bar's internal order of events is unknowable.";
const BOTH_BARRIERS = "A favourable and an adverse barrier were both crossed in one bar.";

interface Bar {
  hR: number;
  lR: number;
}

/** Usable numeric view of a bar, or null when the bar cannot be used. */
function usable(bar: PathBar): Bar | null {
  if (bar.amb) return null;
  if (bar.hR === null || bar.lR === null) return null;
  return { hR: bar.hR, lR: bar.lR };
}

/** True when the bar's low reaches a stop sitting at `stopR` (R from entry). */
const stopHit = (bar: Bar, stopR: number): boolean => bar.lR >= -stopR;
/** True when the bar's high reaches a target sitting at `targetR`. */
const targetHit = (bar: Bar, targetR: number): boolean => bar.hR >= targetR;

function openEnded(path: ExitPath, detail: string): VariantOutcome {
  return undecidable(
    path.truncated ? "The recorded path was capped before an exit." : detail,
  );
}

/** Simulate one exit variant against one recorded path. */
export function simulateVariant(variant: ExitVariant, path: ExitPath): VariantOutcome {
  const tp1 = path.targetsR[0];
  if (tp1 === null || !Number.isFinite(tp1) || tp1 <= 0) {
    return undecidable("The plan has no usable first target in R.");
  }
  if (path.bars.length === 0) return undecidable("No post-entry path was recorded.");

  switch (variant) {
    case "single_exit_first_target":
      return simulateSingle(path, tp1);
    case "partial_tp1_runner_tp2":
      return simulatePartial(path, tp1, path.targetsR[1], "second");
    case "partial_tp1_runner_tp3":
      return simulatePartial(path, tp1, path.targetsR[2], "third");
    case "breakeven_after_1r":
      return simulateBreakeven(path, tp1);
    case "trail_1r":
      return simulateTrail(path, tp1);
  }
}

/** Current policy: first target or the -1R stop, whichever comes first. */
function simulateSingle(path: ExitPath, tp1: number): VariantOutcome {
  for (const raw of path.bars) {
    const bar = usable(raw);
    if (!bar) return undecidable(AMBIGUOUS_BAR);
    const target = targetHit(bar, tp1);
    const stopped = stopHit(bar, -1);
    if (target && stopped) return undecidable(BOTH_BARRIERS);
    if (stopped) return decided(-1);
    if (target) return decided(tp1);
  }
  return openEnded(path, "The path ended with the position still open.");
}

/**
 * Half the position leaves at the first target and the stop on the remainder
 * moves to break-even; the runner then works the deeper target.
 */
function simulatePartial(
  path: ExitPath,
  tp1: number,
  runnerR: number | null,
  label: string,
): VariantOutcome {
  if (runnerR === null || !Number.isFinite(runnerR) || runnerR <= tp1) {
    return undecidable(`The plan defines no ${label} target beyond the first.`);
  }
  const blended = (rest: number) => decided(0.5 * tp1 + 0.5 * rest);
  let partialTaken = false;

  for (const raw of path.bars) {
    const bar = usable(raw);
    if (!bar) return undecidable(AMBIGUOUS_BAR);

    if (!partialTaken) {
      const target = targetHit(bar, tp1);
      const stopped = stopHit(bar, -1);
      if (target && stopped) return undecidable(BOTH_BARRIERS);
      if (stopped) return decided(-1);
      if (!target) continue;
      partialTaken = true;
      // The runner's deeper target may also sit inside this same bar; only its
      // order against the break-even stop would be unknowable, and the stop
      // cannot have been hit before the first target on this bar.
      if (targetHit(bar, runnerR)) return blended(runnerR);
      continue;
    }

    const runnerDone = targetHit(bar, runnerR);
    const breakeven = stopHit(bar, 0);
    if (runnerDone && breakeven) return undecidable(BOTH_BARRIERS);
    if (breakeven) return blended(0);
    if (runnerDone) return blended(runnerR);
  }
  return openEnded(
    path,
    partialTaken
      ? "The runner was still open when the recorded path ended."
      : "The path ended with the position still open.",
  );
}

/** Stop moves to break-even once price has advanced 1R; the exit stays at TP1. */
function simulateBreakeven(path: ExitPath, tp1: number): VariantOutcome {
  let atBreakeven = false;
  for (const raw of path.bars) {
    const bar = usable(raw);
    if (!bar) return undecidable(AMBIGUOUS_BAR);
    const stopR = atBreakeven ? 0 : -1;

    const target = targetHit(bar, tp1);
    const stopped = stopHit(bar, stopR);
    if (target && stopped) return undecidable(BOTH_BARRIERS);
    if (stopped) return decided(stopR);
    if (target) return decided(tp1);

    if (!atBreakeven && targetHit(bar, 1)) {
      // The 1R advance and a retrace to entry can both live in this bar, and
      // their order is unknowable.
      if (stopHit(bar, 0)) return undecidable(BOTH_BARRIERS);
      atBreakeven = true;
    }
  }
  return openEnded(path, "The path ended with the position still open.");
}

/**
 * Trailing stop 1R behind the best excursion, armed once the trade is 1R up.
 * The ladder is not taken: the trail decides the exit.
 */
function simulateTrail(path: ExitPath, tp1: number): VariantOutcome {
  void tp1;
  let best = 0;
  let armed = false;

  for (const raw of path.bars) {
    const bar = usable(raw);
    if (!bar) return undecidable(AMBIGUOUS_BAR);
    const stopR = armed ? best - 1 : -1;

    const stopped = stopHit(bar, stopR);
    const advanced = bar.hR > best;
    if (stopped && advanced) return undecidable(BOTH_BARRIERS);
    if (stopped) return decided(stopR);
    if (advanced) {
      best = bar.hR;
      if (best >= 1) armed = true;
    }
  }
  return openEnded(path, "The trailing position was still open when the path ended.");
}

/** Parses a stored `post_entry_path` value. Returns null when unusable. */
export function parseExitPath(value: unknown): ExitPath | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { bars?: unknown; targetsR?: unknown; truncated?: unknown };
  if (!Array.isArray(raw.bars) || raw.bars.length === 0) return null;
  const bars: PathBar[] = [];
  for (const entry of raw.bars) {
    if (!entry || typeof entry !== "object") return null;
    const b = entry as { t?: unknown; hR?: unknown; lR?: unknown; amb?: unknown };
    if (typeof b.t !== "string") return null;
    bars.push({
      t: b.t,
      hR: typeof b.hR === "number" && Number.isFinite(b.hR) ? b.hR : null,
      lR: typeof b.lR === "number" && Number.isFinite(b.lR) ? b.lR : null,
      amb: b.amb === true,
    });
  }
  const levels = Array.isArray(raw.targetsR) ? raw.targetsR : [];
  const level = (i: number): number | null => {
    const v = levels[i];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  return { bars, targetsR: [level(0), level(1), level(2)], truncated: raw.truncated === true };
}
