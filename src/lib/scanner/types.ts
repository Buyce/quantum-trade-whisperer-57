export type Timeframe = "H4" | "H1" | "M15";
/** A+ is the institutional-confluence tier: an A structure with all 4 pillars. */
export type Grade = "A+" | "A" | "B" | "C";
export type Direction = "long" | "short";
export type Bias = "bullish" | "bearish" | "neutral";

export const INSTRUMENTS = ["XAUUSD", "GBPAUD", "EURUSD"] as const;
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
  /** True when price is reacting inside the Point C liquidity zone. */
  atPointC: boolean;
}

/** The four institutional confluence pillars, each scored 0-100. */
export interface PillarScores {
  /** Pillar 1 — H4/H1/M15 moving-average stack pointing the same way. */
  trend: number;
  /** Pillar 2 — Point C lands inside an H1/H4 institutional supply/demand zone. */
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

export interface ConfidenceBreakdown
  extends Record<"alignment" | "rr" | "symmetry" | "volatility", number> {
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
  tp3: number;
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
 * Institutional confluence weighting: 35% trend alignment, 25% order-block
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
 * Maximum number of published setups per calendar day (No-Trade philosophy).
 * C-Grade setups do NOT consume this quota — only A+, A and B count.
 */
export const DEFAULT_DAILY_SETUP_CAP = 50;

/** Grades that deduct from the daily setup quota. */
export const CAPPED_GRADES: Grade[] = ["A+", "A", "B"];

/**
 * A still-active setup older than this no longer reflects live structure and is
 * swept to `expired` at the start of each scan cycle.
 */
export const SIGNAL_MAX_AGE_HOURS = 24;

/**
 * Two setups count as the same structure when instrument, direction and entry
 * price (to this many decimals) match. Re-publishing one is suppressed.
 */
export const ENTRY_PRICE_DECIMALS = 5;
