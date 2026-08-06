/**
 * Row shapes for the P-Trades tables. Declared locally so the app compiles
 * independently of generated type regeneration.
 */
export type Grade = "A+" | "A" | "B" | "C";
export type Direction = "long" | "short";
export type DecisionKind = "taken" | "skipped";
export type Outcome = "win" | "loss" | "breakeven" | "open";

export interface SignalRow {
  id: string;
  detected_at: string;
  instrument: string;
  grade: Grade;
  direction: Direction;
  entry_price: number;
  stop_loss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  atr: number;
  rr_ratio: number;
  confidence_score: number;
  c_alignment: number;
  c_rr: number;
  c_symmetry: number;
  c_volatility: number;
  pattern_symmetry: number;
  p_trend: number | null;
  p_order_block: number | null;
  p_momentum: number | null;
  p_volatility_expansion: number | null;
  pillars_passed: number | null;
  h4_bias: string | null;
  h1_bias: string | null;
  m15_bias: string | null;
  qualitative_breakdown: string;
  status: string;
  resolved_outcome: Outcome;
  resolved_r_multiple: number | null;
  market_context?: MarketContextRow | MarketContextRow[] | null;
}

export interface MarketContextRow {
  trading_session: string;
  volatility_index: number;
  time_of_day: number;
  day_of_week: number;
}

export interface TradeRow {
  id: string;
  user_id: string;
  signal_id: string;
  user_decision: DecisionKind;
  outcome: Outcome;
  realized_r_multiple: number | null;
  notes: string | null;
  created_at: string;
}

export interface ScannerSettingsRow {
  user_id: string;
  instruments: string[];
  timeframes: string[];
  sessions: string[];
  min_grade: Grade;
  daily_setup_cap: number;
  notify_push: boolean;
  notify_email: boolean;
}

export const SESSION_LABELS: Record<string, string> = {
  sydney: "Sydney",
  tokyo: "Tokyo",
  london: "London",
  london_new_york_overlap: "London / NY overlap",
  new_york: "New York",
};

export const INSTRUMENT_LABELS: Record<string, string> = {
  XAUUSD: "Gold",
  GBPAUD: "GBP/AUD",
  EURUSD: "EUR/USD",
};

export const ALL_INSTRUMENTS: string[] = ["XAUUSD", "GBPAUD", "EURUSD"];
export const ALL_TIMEFRAMES: string[] = ["H4", "H1", "M15"];
export const ALL_SESSIONS: string[] = [
  "sydney",
  "tokyo",
  "london",
  "london_new_york_overlap",
  "new_york",
];


export function contextOf(signal: SignalRow): MarketContextRow | null {
  const ctx = signal.market_context;
  if (!ctx) return null;
  return Array.isArray(ctx) ? (ctx[0] ?? null) : ctx;
}
