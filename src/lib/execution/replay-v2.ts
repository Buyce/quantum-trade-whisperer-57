/**
 * Replay V2 — the execution-credible labeller (research only).
 *
 * Same inputs as Replay V1 (an immutable trade plan plus real M15 candles, no
 * network, no randomness), different adjudication. Every rule below is locked by
 * `REPLAY_V2_SEMANTICS` in `replay-registry.ts` and hashed; changing one means a
 * Replay V3, not an edit here.
 *
 * The five corrections that make labels credible:
 *  1. Time-in-force is enforced BEFORE the fill test. A bar may fill only when
 *     its entire interval lies inside the live-order window. A bar straddling
 *     the deadline fails closed.
 *  2. R is measured against the ACTUAL risk |fill - stop|, so a gap fill can no
 *     longer be paid a full 1R for a smaller risk.
 *  3. Adverse gaps are honest: a bar opening beyond the stop exits at that open
 *     and may lose more than 1R; a plan that gapped through its stop before it
 *     could work is a data-quality outcome, not a loss.
 *  4. Intrabar causality: on an ordinary limit fill the fill bar cannot prove a
 *     target came after entry, so no target is credited from it and the bar
 *     contributes no excursion. Gap-at-open fills existed for the whole bar and
 *     are evaluated normally.
 *  5. Execution ends at the first target. Anything deeper is market-path
 *     analytics that never touches gross R, labels or learning.
 */
import { ORDER_TIF_MINUTES, SIGNAL_MAX_AGE_HOURS, type Candle } from "@/lib/scanner/types";
import { DEFAULT_PIP_SIZE, PIP_SIZE, type ReplayInput } from "./replay";
import { EXECUTION_POLICY_V2, REPLAY_V2_VERSION } from "./replay-registry";

export type ReplayV2Outcome =
  | "win"
  | "loss"
  | "expired"
  | "never_filled"
  /** Non-finite/zero risk, inverted stop, or targets on the wrong side. */
  | "invalid_plan"
  /** The entry-side bar opened at or through the stop while the order still worked. */
  | "gap_beyond_stop";

export type ReplayAdjudication =
  | "clean"
  /** M15 OHLC cannot order two events inside one bar — resolved against us. */
  | "m15_conservative_fallback";

export interface ReplayV2State {
  replayVersion: typeof REPLAY_V2_VERSION;
  executionPolicy: typeof EXECUTION_POLICY_V2;
  status: "open" | "resolved";
  outcome: ReplayV2Outcome | null;
  label: 0 | 1 | null;
  /** Bar-OPEN timestamp of the fill bar. Never a broker execution time. */
  fillBarTime: string | null;
  fillPrice: number | null;
  slippagePips: number | null;
  /** |fill - stop|: the denominator for every R in this row. */
  riskPriceActual: number | null;
  grossR: number | null;
  /** Reserved for a documented broker cost schedule; always null today. */
  netR: null;
  mfeR: number;
  maeR: number;
  barsReplayed: number;
  barsToOutcome: number | null;
  replayCursor: string | null;
  missDistanceAtr: number | null;
  fillGapThrough: boolean;
  stopGapThrough: boolean;
  fillAmbiguousTif: boolean;
  fillBarExcursionAmbiguous: boolean;
  ambiguousBars: number;
  /** Unproven post-entry target touch on an ordinary fill bar (1 | 2 | 3). */
  ambiguousBarTargetTouch: number | null;
  adjudication: ReplayAdjudication;
  /** NULL whenever the order of the two events is unknowable. */
  tp1BeforeStop: boolean | null;
  stopBeforeTp1: boolean | null;
  /** The realized exit target under `single_exit_first_target`. */
  firstTargetTouched: number | null;
  /** Deepest target the market path touched — analytics only. */
  maxTargetTouched: number | null;
}

const ms = (iso: string) => new Date(iso).getTime();
const M15_MS = 15 * 60_000;

export function replaySetupV2(input: ReplayInput, candles: Candle[]): ReplayV2State {
  const isLong = input.direction === "long";
  const pip = PIP_SIZE[input.instrument] ?? DEFAULT_PIP_SIZE;

  const state: ReplayV2State = {
    replayVersion: REPLAY_V2_VERSION,
    executionPolicy: EXECUTION_POLICY_V2,
    status: "open",
    outcome: null,
    label: null,
    fillBarTime: input.filledAt,
    fillPrice: input.fillPrice,
    slippagePips: null,
    riskPriceActual: null,
    grossR: null,
    netR: null,
    mfeR: input.mfeR ?? 0,
    maeR: input.maeR ?? 0,
    barsReplayed: input.barsReplayed ?? 0,
    barsToOutcome: null,
    replayCursor: input.replayCursor,
    missDistanceAtr: null,
    fillGapThrough: false,
    stopGapThrough: false,
    fillAmbiguousTif: false,
    fillBarExcursionAmbiguous: false,
    ambiguousBars: 0,
    ambiguousBarTargetTouch: null,
    adjudication: "clean",
    tp1BeforeStop: null,
    stopBeforeTp1: null,
    firstTargetTouched: null,
    maxTargetTouched: null,
  };

  // --- Plan validity (fails closed, never a fabricated loss) -----------------
  if (!planIsValid(input, isLong)) {
    return { ...state, status: "resolved", outcome: "invalid_plan", label: null, grossR: null };
  }
  if (state.fillPrice != null) {
    state.riskPriceActual = Math.abs(state.fillPrice - input.stopLoss);
  }

  const detected = ms(input.detectedAt);
  const tifDeadline = detected + ORDER_TIF_MINUTES * 60_000;
  const verticalBarrier = detected + SIGNAL_MAX_AGE_HOURS * 3_600_000;
  const cursor = state.replayCursor ? ms(state.replayCursor) : detected;

  const atr = Number(input.atr);
  const hasAtr = Number.isFinite(atr) && atr > 0;
  let closest: number | null = null;
  const noteApproach = (candle: Candle) => {
    const reach = isLong ? candle.low : candle.high;
    if (closest == null) closest = reach;
    else closest = isLong ? Math.min(closest, reach) : Math.max(closest, reach);
  };
  const missAtr = () => {
    if (!hasAtr || closest == null) return null;
    const gap = isLong ? closest - input.entryPrice : input.entryPrice - closest;
    return Number((gap / atr).toFixed(4));
  };

  const fresh = state.replayCursor == null;
  const relevant = candles
    .filter((c) => (fresh ? ms(c.time) + M15_MS > detected : ms(c.time) > cursor))
    .sort((a, b) => ms(a.time) - ms(b.time));

  /** Ladder prices, ordered TP1 → TP3, used for touch analytics only. */
  const ladder = [input.tp1, input.tp2, input.tp3].filter(
    (p): p is number => p != null && Number.isFinite(p),
  );
  const deepestTouched = (candle: Candle): number | null => {
    let idx: number | null = null;
    ladder.forEach((price, i) => {
      const hit = isLong ? candle.high >= price : candle.low <= price;
      if (hit) idx = i + 1;
    });
    return idx;
  };

  /** True once a stop has been observed on an earlier bar than a TP touch. */
  let sawTargetTouchBeforeThisBar = false;

  for (const candle of relevant) {
    const t = ms(candle.time);
    const barEnd = t + M15_MS;
    state.replayCursor = candle.time;
    let gapAtOpenFill = false;

    // --- Fill leg (TIF first) ------------------------------------------------
    if (!state.fillBarTime) {
      const wholeBarLive = barEnd <= tifDeadline;
      const touched = isLong ? candle.low <= input.entryPrice : candle.high >= input.entryPrice;

      if (!wholeBarLive) {
        // The order was not demonstrably live for this whole bar. A touch here
        // is unprovable, so it is recorded and refused.
        if (touched) state.fillAmbiguousTif = true;
        else noteApproach(candle);
        return {
          ...state,
          status: "resolved",
          outcome: "never_filled",
          label: 0,
          grossR: 0,
          barsToOutcome: state.barsReplayed,
          missDistanceAtr: missAtr(),
        };
      }

      if (!touched) {
        noteApproach(candle);
        state.barsReplayed += 1;
        continue;
      }

      const gapped = isLong ? candle.open < input.entryPrice : candle.open > input.entryPrice;
      if (gapped) {
        const openBeyondStop = isLong
          ? candle.open <= input.stopLoss
          : candle.open >= input.stopLoss;
        if (openBeyondStop) {
          // The plan was never executable: price was already past the stop when
          // the order could first work. Not a loss — a data-quality outcome.
          return {
            ...state,
            status: "resolved",
            outcome: "gap_beyond_stop",
            label: null,
            grossR: null,
            fillGapThrough: true,
            barsToOutcome: state.barsReplayed,
          };
        }
      }
      const fill = gapped ? candle.open : input.entryPrice;
      state.fillBarTime = candle.time;
      state.fillPrice = fill;
      state.fillGapThrough = gapped;
      state.slippagePips = Math.abs(fill - input.entryPrice) / pip;
      state.riskPriceActual = Math.abs(fill - input.stopLoss);
      gapAtOpenFill = gapped;

      if (!Number.isFinite(state.riskPriceActual) || state.riskPriceActual <= 0) {
        return { ...state, status: "resolved", outcome: "invalid_plan", label: null, grossR: null };
      }

      if (!gapAtOpenFill) {
        // Ordinary intrabar fill: this bar can prove neither the order of events
        // nor the excursions that followed entry.
        state.barsReplayed += 1;
        state.fillBarExcursionAmbiguous = true;
        const stopHit = isLong ? candle.low <= input.stopLoss : candle.high >= input.stopLoss;
        const target = deepestTouched(candle);
        if (stopHit) {
          state.ambiguousBars += 1;
          state.adjudication = "m15_conservative_fallback";
          if (target != null) state.ambiguousBarTargetTouch = target;
          return {
            ...state,
            status: "resolved",
            outcome: "loss",
            label: 0,
            grossR: -1,
            barsToOutcome: state.barsReplayed,
          };
        }
        if (target != null) {
          state.ambiguousBars += 1;
          state.adjudication = "m15_conservative_fallback";
          state.ambiguousBarTargetTouch = target;
          sawTargetTouchBeforeThisBar = true;
        }
        if (t >= verticalBarrier) {
          return { ...state, ...markToClose(state, input, candle, isLong) };
        }
        continue;
      }
    }

    const risk = state.riskPriceActual as number;
    const base = state.fillPrice as number;
    state.barsReplayed += 1;

    // --- Excursions (post-fill only) ----------------------------------------
    const favorable = isLong ? candle.high - base : base - candle.low;
    const adverse = isLong ? base - candle.low : candle.high - base;
    state.mfeR = Math.max(state.mfeR, favorable / risk);
    state.maeR = Math.max(state.maeR, adverse / risk);

    // --- Horizontal barriers -------------------------------------------------
    const stopHit = isLong ? candle.low <= input.stopLoss : candle.high >= input.stopLoss;
    const openBeyondStop = isLong ? candle.open < input.stopLoss : candle.open > input.stopLoss;
    const tp1Hit = isLong ? candle.high >= input.tp1 : candle.low <= input.tp1;
    const target = deepestTouched(candle);

    if (stopHit && openBeyondStop && !gapAtOpenFill) {
      // Adverse gap: the exit is the open, and it can be worse than -1R.
      const exit = candle.open;
      return {
        ...state,
        status: "resolved",
        outcome: "loss",
        label: 0,
        stopGapThrough: true,
        grossR: (isLong ? exit - base : base - exit) / risk,
        barsToOutcome: state.barsReplayed,
        tp1BeforeStop: tp1Hit ? null : sawTargetTouchBeforeThisBar ? null : false,
        stopBeforeTp1: tp1Hit ? null : sawTargetTouchBeforeThisBar ? null : true,
      };
    }

    if (stopHit && tp1Hit) {
      // Unknowable order inside one bar → resolved against us, chronology NULL.
      state.ambiguousBars += 1;
      state.adjudication = "m15_conservative_fallback";
      if (target != null) state.ambiguousBarTargetTouch = target;
      return {
        ...state,
        status: "resolved",
        outcome: "loss",
        label: 0,
        grossR: -1,
        barsToOutcome: state.barsReplayed,
        tp1BeforeStop: null,
        stopBeforeTp1: null,
      };
    }

    if (stopHit) {
      return {
        ...state,
        status: "resolved",
        outcome: "loss",
        label: 0,
        grossR: -1,
        barsToOutcome: state.barsReplayed,
        tp1BeforeStop: sawTargetTouchBeforeThisBar ? null : false,
        stopBeforeTp1: sawTargetTouchBeforeThisBar ? null : true,
      };
    }

    if (tp1Hit) {
      // Execution ends at the first target. A favorable gap through TP1 is
      // credited at the TARGET price — never the better open.
      const exit = input.tp1;
      return {
        ...state,
        status: "resolved",
        outcome: "win",
        label: 1,
        grossR: (isLong ? exit - base : base - exit) / risk,
        firstTargetTouched: 1,
        maxTargetTouched: target,
        barsToOutcome: state.barsReplayed,
        tp1BeforeStop: true,
        stopBeforeTp1: false,
      };
    }

    // --- Vertical barrier ----------------------------------------------------
    if (t >= verticalBarrier) {
      return { ...state, ...markToClose(state, input, candle, isLong) };
    }
  }

  return state;
}

function markToClose(
  state: ReplayV2State,
  input: ReplayInput,
  candle: Candle,
  isLong: boolean,
): Partial<ReplayV2State> {
  const risk = state.riskPriceActual as number;
  const base = state.fillPrice as number;
  return {
    status: "resolved",
    outcome: "expired",
    label: 0,
    grossR: (isLong ? candle.close - base : base - candle.close) / risk,
    barsToOutcome: state.barsReplayed,
  };
}

function planIsValid(input: ReplayInput, isLong: boolean): boolean {
  const risk = Math.abs(input.riskPrice);
  if (!Number.isFinite(risk) || risk <= 0) return false;
  const prices = [input.entryPrice, input.stopLoss, input.tp1, input.tp2];
  if (prices.some((p) => !Number.isFinite(p))) return false;
  if (isLong) {
    if (input.stopLoss >= input.entryPrice) return false;
    if (input.tp1 <= input.entryPrice) return false;
  } else {
    if (input.stopLoss <= input.entryPrice) return false;
    if (input.tp1 >= input.entryPrice) return false;
  }
  return true;
}
