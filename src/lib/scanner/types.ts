export type Timeframe = "H4" | "H1" | "M15";
export type Grade = "A" | "B" | "C";
export type Direction = "long" | "short";
export type Bias = "bullish" | "bearish" | "neutral";

export const INSTRUMENTS = ["XAUUSD", "GBPAUD", "EURUSD"] as const;
export const TIMEFRAMES: Timeframe[] = ["H4", "H1", "M15"];

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
  h4Bias: string;
  h1Bias: string;
  m15Bias: string;
  qualitativeBreakdown: string;
}

/** Weighted confidence model: 40% alignment, 30% R:R, 20% symmetry, 10% volatility. */
export const CONFIDENCE_WEIGHTS = {
  alignment: 0.4,
  rr: 0.3,
  symmetry: 0.2,
  volatility: 0.1,
} as const;

/** Maximum number of published setups per calendar day (No-Trade philosophy). */
export const DEFAULT_DAILY_SETUP_CAP = 15;
