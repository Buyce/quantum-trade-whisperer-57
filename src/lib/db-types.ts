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
  tp3: number | null;
  /** True R multiple of each target — legacy rows are null and assume 1/2/3. */
  tp1_r: number | null;
  tp2_r: number | null;
  tp3_r: number | null;
  /** Maximum reachable R before the nearest H4 structural barrier. */
  max_r: number | null;
  structure_key: string | null;
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
  expired_at: string | null;
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

export interface TradeHistoryRow extends TradeRow {
  scanned_signals: SignalRow | SignalRow[] | null;
}

export interface ScannerSettingsRow {
  user_id: string;
  instruments: string[];
  timeframes: string[];
  sessions: string[];
  min_grade: Grade;
  /** Independent alert threshold — which tiers may trigger push/email alerts. */
  alert_min_grade: Grade;
  daily_setup_cap: number;
  notify_push: boolean;
  notify_email: boolean;
}

export const GRADE_RANK: Record<Grade, number> = { "A+": 4, A: 3, B: 2, C: 1 };

/**
 * Feed retention windows, measured from `detected_at`. These MUST mirror the
 * thresholds in the SQL function `public.purge_expired_signals()`.
 */
export const RETENTION_HOURS: Record<Grade, number> = { "A+": 48, A: 48, B: 36, C: 24 };

/** True while a signal is still inside its grade's retention window. */
export function isWithinRetention(signal: Pick<SignalRow, "grade" | "detected_at">, now = Date.now()) {
  const hours = RETENTION_HOURS[signal.grade] ?? 24;
  return now - new Date(signal.detected_at).getTime() < hours * 3_600_000;
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


/**
 * The R multiple of each target. Legacy rows predate the columns and were built
 * on the fixed 1/2/3 ladder, so they fall back to it rather than showing "—".
 */
export function targetLadder(signal: SignalRow): Array<{ label: string; r: number; price: number }> {
  const rows: Array<{ label: string; r: number; price: number }> = [];
  const add = (n: number, r: number | null, price: number | null, fallback: number) => {
    if (price === null || price === undefined) return;
    const mult = r ?? fallback;
    rows.push({ label: `TP${n} · 1:${mult.toFixed(mult % 1 === 0 ? 0 : 2)}`, r: mult, price });
  };
  add(1, signal.tp1_r, signal.tp1, 1);
  add(2, signal.tp2_r, signal.tp2, 2);
  add(3, signal.tp3_r, signal.tp3, 3);
  return rows;
}

/** True when the H4 barrier, not the 1:3 default, sets the final target. */
export function isCapped(signal: SignalRow): boolean {
  return signal.max_r !== null && signal.max_r < 3;
}

export function contextOf(signal: SignalRow): MarketContextRow | null {
  const ctx = signal.market_context;
  if (!ctx) return null;
  return Array.isArray(ctx) ? (ctx[0] ?? null) : ctx;
}
