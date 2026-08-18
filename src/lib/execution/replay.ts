/**
 * Deterministic Triple-Barrier replay (Lopez de Prado meta-labelling).
 *
 * Pure functions over real M15 candles — no broker, no network, no randomness.
 * The same candles always produce the same label, so a run can be repeated or
 * backfilled safely. Nothing here invents prices: if candles are missing the
 * replay simply does not advance.
 */
import { ORDER_TIF_MINUTES, SIGNAL_MAX_AGE_HOURS, type Candle } from "@/lib/scanner/types";

/** Pip size per instrument — used only to express fill slippage in pips. */
export const PIP_SIZE: Record<string, number> = {
  EURUSD: 0.0001,
  GBPAUD: 0.0001,
  XAUUSD: 0.1,
};
export const DEFAULT_PIP_SIZE = 0.0001;

export type ShadowOutcome = "win" | "loss" | "expired" | "never_filled";

export interface ReplayInput {
  direction: "long" | "short";
  instrument: string;
  detectedAt: string;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number | null;
  tp1R: number | null;
  tp2R: number | null;
  tp3R: number | null;
  /** abs(entry - stop): the 1R unit in price terms. */
  riskPrice: number;
  /** Resume point — only candles strictly after this are consumed. */
  replayCursor: string | null;
  filledAt: string | null;
  fillPrice: number | null;
  mfeR: number | null;
  maeR: number | null;
  barsReplayed: number;
}

export interface ReplayState {
  status: "open" | "resolved";
  filledAt: string | null;
  fillPrice: number | null;
  slippagePips: number | null;
  mfeR: number;
  maeR: number;
  barsReplayed: number;
  barsToOutcome: number | null;
  realizedR: number | null;
  outcome: ShadowOutcome | null;
  label: 0 | 1 | null;
  replayCursor: string | null;
}

const ms = (iso: string) => new Date(iso).getTime();

/**
 * Replay `candles` against one setup, resuming from its stored cursor.
 *
 * Conventions, chosen to be conservative rather than flattering:
 * - Entry is a limit at `entryPrice`; it fills when a candle's range contains
 *   it, and only within the TIF window. Past TIF with no touch → never_filled.
 * - Within a single candle a stop touch beats a target touch (we cannot see
 *   intrabar order, so we assume the worse sequence).
 * - The vertical barrier is SIGNAL_MAX_AGE_HOURS after detection.
 */
export function replaySetup(input: ReplayInput, candles: Candle[]): ReplayState {
  const isLong = input.direction === "long";
  const pip = PIP_SIZE[input.instrument] ?? DEFAULT_PIP_SIZE;
  const risk = Math.abs(input.riskPrice);

  const state: ReplayState = {
    status: "open",
    filledAt: input.filledAt,
    fillPrice: input.fillPrice,
    slippagePips: null,
    mfeR: input.mfeR ?? 0,
    maeR: input.maeR ?? 0,
    barsReplayed: input.barsReplayed ?? 0,
    barsToOutcome: null,
    realizedR: null,
    outcome: null,
    label: null,
    replayCursor: input.replayCursor,
  };

  if (!Number.isFinite(risk) || risk <= 0) {
    return { ...state, status: "resolved", outcome: "never_filled", label: 0 };
  }

  const detected = ms(input.detectedAt);
  const tifDeadline = detected + ORDER_TIF_MINUTES * 60_000;
  const verticalBarrier = detected + SIGNAL_MAX_AGE_HOURS * 3_600_000;
  const cursor = state.replayCursor ? ms(state.replayCursor) : detected;

  const ladder = buildLadder(input, isLong, risk);

  const relevant = candles
    .filter((c) => ms(c.time) > cursor)
    .sort((a, b) => ms(a.time) - ms(b.time));

  for (const candle of relevant) {
    const t = ms(candle.time);
    state.replayCursor = candle.time;

    // --- Fill leg -----------------------------------------------------------
    if (!state.filledAt) {
      const touched = candle.low <= input.entryPrice && candle.high >= input.entryPrice;
      if (touched) {
        // A gap-through bar fills at the open, which is the only real slippage
        // a limit order can suffer.
        const gapped = isLong ? candle.open < input.entryPrice : candle.open > input.entryPrice;
        const fill = gapped ? candle.open : input.entryPrice;
        state.filledAt = candle.time;
        state.fillPrice = fill;
        state.slippagePips = Math.abs(fill - input.entryPrice) / pip;
      } else {
        if (t > tifDeadline) {
          return {
            ...state,
            status: "resolved",
            outcome: "never_filled",
            label: 0,
            realizedR: 0,
            barsToOutcome: state.barsReplayed,
          };
        }
        state.barsReplayed += 1;
        continue;
      }
    }

    state.barsReplayed += 1;

    // --- Excursions ---------------------------------------------------------
    const base = state.fillPrice ?? input.entryPrice;
    const favorable = isLong ? candle.high - base : base - candle.low;
    const adverse = isLong ? base - candle.low : candle.high - base;
    state.mfeR = Math.max(state.mfeR, favorable / risk);
    state.maeR = Math.max(state.maeR, adverse / risk);

    // --- Horizontal barriers (stop first: conservative) ----------------------
    const stopHit = isLong ? candle.low <= input.stopLoss : candle.high >= input.stopLoss;
    if (stopHit) {
      return {
        ...state,
        status: "resolved",
        outcome: "loss",
        label: 0,
        realizedR: -1,
        barsToOutcome: state.barsReplayed,
      };
    }

    let best: { r: number } | null = null;
    for (const step of ladder) {
      const hit = isLong ? candle.high >= step.price : candle.low <= step.price;
      if (hit) best = { r: step.r };
    }
    if (best) {
      return {
        ...state,
        status: "resolved",
        outcome: "win",
        label: 1,
        realizedR: best.r,
        barsToOutcome: state.barsReplayed,
      };
    }

    // --- Vertical barrier ---------------------------------------------------
    if (t >= verticalBarrier) {
      return {
        ...state,
        status: "resolved",
        outcome: "expired",
        label: 0,
        // Exit at the close of the barrier candle — the honest mark-to-market.
        realizedR: ((isLong ? candle.close - base : base - candle.close) / risk),
        barsToOutcome: state.barsReplayed,
      };
    }
  }

  // No barrier reached with the candles available: stay open, keep the cursor.
  // If the vertical barrier has already passed in wall-clock time but we have no
  // candles covering it (weekend/holiday closure), we simply wait — never guess.
  return state;
}

function buildLadder(input: ReplayInput, isLong: boolean, risk: number) {
  const steps: Array<{ price: number; r: number }> = [
    { price: input.tp1, r: input.tp1R ?? rOf(input.tp1, input, isLong, risk) },
    { price: input.tp2, r: input.tp2R ?? rOf(input.tp2, input, isLong, risk) },
  ];
  if (input.tp3 != null) {
    steps.push({ price: input.tp3, r: input.tp3R ?? rOf(input.tp3, input, isLong, risk) });
  }
  return steps
    .filter((s) => Number.isFinite(s.price) && Number.isFinite(s.r))
    .sort((a, b) => a.r - b.r);
}

function rOf(price: number, input: ReplayInput, isLong: boolean, risk: number) {
  return (isLong ? price - input.entryPrice : input.entryPrice - price) / risk;
}
