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
  /** Slippage ceiling — legacy rows are null and are derived client-side. */
  max_acceptable_entry: number | null;
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
  /**
   * Advisory Bayesian priors from the shadow telemetry engine. Null on rows
   * published before the intelligence layer, and null whenever the statistics
   * table was unreadable. Display only — nothing branches on these.
   */
  p_fill_prior: number | null;
  p_win_prior: number | null;
  ev_prior: number | null;
  p_joint_prior: number | null;
  prior_sample_n: number | null;
  prior_filled_n: number | null;
  prior_tier: number | null;
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
  /** Real fill price the user reported. Optional. */
  actual_entry_price: number | null;
  /** Real exit price the user reported. Optional. */
  actual_exit_price: number | null;
  /** R derived server-side from the reported prices. Never client-supplied. */
  derived_r: number | null;
  /**
   * Who entered the prices: the person in the web terminal, or an AI assistant
   * over MCP. Stamped server-side from the request path, null when unverified.
   */
  price_source: "human" | "agent" | null;
  /** OAuth client id of the assistant that wrote the prices, when agent-entered. */
  price_source_client: string | null;
  price_recorded_at: string | null;
  /** Who logged the taken/skipped decision: the web terminal or an AI assistant. */
  decision_source: "human" | "agent" | null;
  /** OAuth client id of the assistant that logged the decision, when agent-logged. */
  decision_source_client: string | null;
  notes: string | null;
  created_at: string;

  /**
   * Immutable creation-time snapshot of the plan and its market context. These
   * are the canonical journal-maths inputs: they keep working after the
   * originating signal row leaves retention.
   */
  planned_entry?: number | null;
  planned_stop?: number | null;
  planned_direction?: "long" | "short" | null;
  signal_detected_at?: string | null;
  signal_instrument?: string | null;
  signal_grade?: Grade | null;
  signal_trading_session?: string | null;
  signal_time_of_day?: number | null;
  signal_day_of_week?: number | null;

  /** Stop actually placed at the broker, when the trader recorded it. */
  actual_initial_stop?: number | null;
  actual_entry_at?: string | null;
  actual_exit_at?: string | null;
  broker_ticket?: string | null;

  /** Monetary costs. Money, never a price distance. */
  commission?: number | null;
  swap?: number | null;
  cost_currency?: string | null;
  cost_unit?: "account_currency" | "instrument_quote" | "points" | "unknown" | null;

  /**
   * Canonical dual-basis R. Never averaged together; a consumer names its basis.
   * `realized_r_multiple` / `derived_r` above are FROZEN legacy provenance.
   */
  r_vs_plan?: number | null;
  r_vs_actual_risk?: number | null;
  r_availability?: string | null;
  stop_provenance?: "actual_stop" | "planned_stop_fallback" | "unavailable" | null;
  r_math_version?: number | null;
  net_r?: number | null;
  verification_level?: "unverified" | "self_reported" | "plan_verified" | null;
  trade_state?: "logged" | "open" | "resolved" | null;
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
  /** Manual order guidance: adaptive market/limit, or limit-only on the retest. */
  order_strategy: OrderStrategy;
  webhook_enabled: boolean;
  webhook_url: string | null;
  webhook_format: WebhookFormat;
  /** Per-user execution switches. They are server-written after validation. */
  execution_enabled: boolean;
  execution_dry_run: boolean;
  exposure_limit_enabled: boolean;
  webhook_validated_at: string | null;
  webhook_validation_reason: string | null;
  /**
   * Personal risk profile. The scanner and grading engine never read it. The
   * terminal sizing service uses it for advisory cards, and a separately armed
   * execution destination may use it during server-side pre-submit sizing.
   */
  account_equity: number;
  account_currency: string;
  risk_per_trade_percent: number;
  /** Hard lot ceiling; 0 means no cap. */
  max_position_size: number;
  leverage: number;
  /** Max stop distance as a percent of entry; 0 means the check is off. */
  max_stop_loss_percent: number;
  /** When the user last confirmed their entered balance. Never broker-confirmed. */
  equity_as_of: string | null;
  /** Persisted acknowledgement required to risk more than 2% per trade. */
  risk_ack_high: boolean;
}

export type OrderStrategy = "smart_adaptive" | "strict_retest";
export type WebhookFormat = "json" | "pineconnector";

/**
 * Time-in-force for every pending order: two M15 candles. After that the market
 * is no longer the one the setup was graded in, so an unfilled order is stale.
 */
export const ORDER_TIF_MINUTES = 30;

/**
 * Worst price at which taking the setup at market still preserves the payoff the
 * grade was based on. Stored per signal by the scanner; older rows predate the
 * column and are derived from the same formula so the card never shows "—".
 */
export function maxAcceptableEntry(
  signal: Pick<
    SignalRow,
    "max_acceptable_entry" | "entry_price" | "stop_loss" | "direction" | "max_r"
  >,
): number {
  if (signal.max_acceptable_entry !== null && signal.max_acceptable_entry !== undefined) {
    return Number(signal.max_acceptable_entry);
  }
  const entry = Number(signal.entry_price);
  const risk = Math.abs(entry - Number(signal.stop_loss));
  const tolerance = signal.max_r !== null && Number(signal.max_r) < 1.5 ? 0.1 : 0.15;
  const sign = signal.direction === "long" ? 1 : -1;
  return entry + sign * risk * tolerance;
}

export const GRADE_RANK: Record<Grade, number> = { "A+": 4, A: 3, B: 2, C: 1 };

/**
 * Feed retention windows, measured from `detected_at`. These MUST mirror the
 * thresholds in the SQL function `public.purge_expired_signals()`.
 */
export const RETENTION_HOURS: Record<Grade, number> = { "A+": 48, A: 48, B: 36, C: 24 };

/** True while a signal is still inside its grade's retention window. */
export function isWithinRetention(
  signal: Pick<SignalRow, "grade" | "detected_at">,
  now = Date.now(),
) {
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
export function targetLadder(
  signal: SignalRow,
): Array<{ label: string; r: number; price: number }> {
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
