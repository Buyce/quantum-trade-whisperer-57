import { WAVE0_SYMBOLS, spreadFloors } from "@/lib/instruments/registry";

export type Timeframe = "H4" | "H1" | "M15";
/** A+ is the four-rule-confluence tier: an A structure with all 4 pillars. */
export type Grade = "A+" | "A" | "B" | "C";
export type Direction = "long" | "short";
export type Bias = "bullish" | "bearish" | "neutral";

/**
 * The scan universe.
 *
 * Derived from the instrument registry rather than written out here, but still
 * pinned to Wave 0: a Wave 1 pair joins the scan cycle only once its lifecycle
 * stage reaches `data_validation`, which the scan enqueue path checks at run
 * time. Widening this constant would opt every user in silently, so it stays
 * frozen.
 */
export const INSTRUMENTS: readonly string[] = WAVE0_SYMBOLS;
export const TIMEFRAMES: Timeframe[] = ["H4", "H1", "M15"];

/**
 * Per-timeframe candle depth. H4/H1 fetch 300 so the 200-period EMA has real
 * warm-up and order-block detection sees more unmitigated structure.
 */
export const CANDLE_LIMITS: Record<Timeframe, number> = { H4: 300, H1: 300, M15: 200 };

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface TimeframeRead {
  timeframe: Timeframe;
  bias: Bias;
  /** Distance from price to the nearest higher-timeframe structural barrier, in ATR units. */
  barrierDistanceAtr: number;
  atr: number;
  /** Absolute price of that nearest structural barrier. */
  barrierPrice: number;
  /** High of the recent range on this timeframe — the barrier a long runs into. */
  rangeHigh: number;
  /** Low of the recent range on this timeframe — the barrier a short runs into. */
  rangeLow: number;
  /** True when price passes V1's recent-range Point-C test. */
  atPointC: boolean;
}

/** The four deterministic confluence pillars, each scored 0-100. */
export interface PillarScores {
  /** Pillar 1 — H4/H1/M15 moving-average stack pointing the same way. */
  trend: number;
  /** Pillar 2 — Point C proximity to an H1/H4 OHLC-derived zone heuristic. */
  orderBlock: number;
  /** Pillar 3 — M15 RSI extreme or divergence at Point C. */
  momentum: number;
  /** Pillar 4 — M15 ATR at or above its 20-period ATR moving average. */
  volatilityExpansion: number;
  /** How many pillars cleared the pass threshold (0-4). */
  passed: number;
  /** Human-readable one-liner per pillar, folded into the qualitative breakdown. */
  notes: string[];
}

/** A pillar counts as satisfied at or above this score. */
export const PILLAR_PASS_SCORE = 60;

export interface ConfidenceBreakdown extends Record<
  "alignment" | "rr" | "symmetry" | "volatility",
  number
> {
  score: number;
}

export interface TradeProfile {
  instrument: string;
  grade: Grade;
  direction: Direction;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  /** Null when the structure cannot reach a third target before the H4 barrier. */
  tp3: number | null;
  /** True R multiple of each target — never assumed to be 1/2/3. */
  tp1R: number;
  tp2R: number;
  tp3R: number | null;
  /** Maximum reachable R before the nearest H4 structural barrier. */
  maxR: number;
  /** Slippage ceiling: worst price at which entering at market is still sane. */
  maxAcceptableEntry: number;
  /** True when maxR (not the 1:3 default) is what sets the final target. */
  capped: boolean;
  /** Stable identity of the ABC structure this setup came from. */
  structureKey: string;
  atr: number;
  rrRatio: number;
  patternSymmetry: number;
  confidence: ConfidenceBreakdown;
  pillars: PillarScores;
  h4Bias: string;
  h1Bias: string;
  m15Bias: string;
  qualitativeBreakdown: string;
}

/**
 * Four-rule confluence weighting: 35% trend alignment, 25% OHLC-zone
 * retest, 20% momentum exhaustion, 20% volatility expansion. R:R is applied
 * afterwards as a multiplier cap rather than a fifth weight, so a great
 * structure with a poor payoff cannot score highly.
 */
export const CONFIDENCE_WEIGHTS = {
  trend: 0.35,
  orderBlock: 0.25,
  momentum: 0.2,
  volatilityExpansion: 0.2,
} as const;

/**
 * Grades that deduct from a user's personal daily cap
 * (`scanner_settings.daily_setup_cap`, 0 = unlimited). C-Grade never counts.
 * The scanner itself publishes without any global ceiling.
 */
export const CAPPED_GRADES: Grade[] = ["A+", "A", "B"];

/**
 * A still-active setup older than this no longer reflects live structure and is
 * swept to `expired` at the start of each scan cycle.
 */
export const SIGNAL_MAX_AGE_HOURS = 24;

/**
 * Slippage tolerance above (long) / below (short) the entry price before the
 * planned payoff is materially broken.
 *
 * The stop and targets do not move when the entry slips, so both sides of the
 * ratio change: risk grows to (1 + 0.15)R and reward falls to (3 - 0.15)R. A
 * 1:3 setup filled at the tolerance limit therefore realises 2.85 / 1.15 =
 * ~1:2.478, not 1:2.55. A real but survivable haircut. Thin extensions
 * (maxR < 1.5) use the tighter figure so a marginal setup cannot be slipped
 * into negative expectancy.
 */
export const SLIPPAGE_TOLERANCE_R = 0.15;
export const TIGHT_SLIPPAGE_TOLERANCE_R = 0.1;

/**
 * Time-in-force: an unfilled pending order is cancelled after two M15 candles.
 * After that the market is no longer the one that was graded.
 */
export const ORDER_TIF_MINUTES = 30;

/**
 * Stop-loss construction. Industry practice for a 15m breakout structure is
 * 1.0-1.5x ATR beyond the structural extreme; we take 1.2x M15 ATR with a
 * 0.5x H1 ATR floor so the stop also survives H1 noise, and a hard
 * per-instrument spread floor so it can never sit inside execution cost.
 */
export const STOP_M15_ATR_MULTIPLIER = 1.2;
export const STOP_H1_ATR_FLOOR = 0.5;

/**
 * Minimum stop buffer in absolute price terms — realistic spread + slippage.
 *
 * Only instruments with an explicit, validated floor appear here (Wave 0 today).
 * A pair without one must not reach publication on the shared default: the
 * readiness check derives its floor from the broker's own point size and a
 * measured spread before the pair may leave `disabled`.
 */
export const SPREAD_FLOOR: Record<string, number> = spreadFloors();
export const DEFAULT_SPREAD_FLOOR = 0.0002;

/** True when this instrument's stop floor is validated rather than defaulted. */
export function hasValidatedSpreadFloor(instrument: string): boolean {
  return Object.prototype.hasOwnProperty.call(SPREAD_FLOOR, instrument);
}

/** Risk wider than this many M15 ATR is rejected as No-Trade, not published. */
export const MAX_RISK_ATR = 3;

/** Below this reachable R the structure is not worth publishing at all. */
export const MIN_REACHABLE_R = 1;

/** A structure may not republish within this window, even once retired. */
export const STRUCTURE_COOLDOWN_MINUTES = 120;

/**
 * Two setups count as the same structure when instrument, direction and entry
 * price (to this many decimals) match. Re-publishing one is suppressed.
 */
export const ENTRY_PRICE_DECIMALS = 5;

/**
 * Sessions where momentum rarely retests a deep Point C. Phase 0 measured a 13%
 * fill rate in the London/New York overlap versus 69% in standard London, so the
 * limit entry is shifted toward the breakout close in this regime only.
 */
export const RUNAWAY_SESSIONS: string[] = ["london_new_york_overlap"];

/** Retracement from the detection candle's close used for the dynamic entry. */
export const DYNAMIC_ENTRY_ATR_FRACTION = 0.3;

/**
 * A dynamic entry must keep at least this much M15 ATR between itself and the
 * structural stop. Below it the trade is a coin flip on spread, so the entry
 * falls back to Point C.
 */
export const MIN_DYNAMIC_RISK_ATR = 0.5;
