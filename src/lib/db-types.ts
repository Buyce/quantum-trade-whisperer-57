/**
 * Row shapes for the P-Trades tables. Declared locally so the app compiles
 * independently of generated type regeneration.
 */
import { isStage, mayPublish, mayScan } from "@/lib/instruments/lifecycle";
import { REGISTRY_SYMBOLS, WAVE0_SYMBOLS, instrumentLabels } from "@/lib/instruments/registry";

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
  /**
   * Optional intelligence gate on AUTOMATIC ORDERS ONLY. Off by default, and
   * reduce-only: it can refuse an order, never authorise one. A NULL threshold
   * means unconfigured, and an unconfigured gate refuses nothing.
   */
  auto_intel_gate_enabled: boolean;
  auto_intel_min_win_pct: number | null;
  auto_intel_min_sample: number;
  /**
   * Owner opt-in for C-Grade AUTOMATIC ORDERS. False by default, which keeps the
   * historical unconditional refusal. True does not authorise anything on its
   * own: a C-Grade setup still faces the alert tier, instruments, sessions,
   * risk, lot ceiling, exposure, the intelligence gate and pre-send
   * revalidation. C-Grade alerts are governed separately by alert_min_grade.
   */
  auto_execute_c_grade: boolean;
  /**
   * LEGACY single ceiling, retained so historical rows and decisions stay
   * readable. It is superseded by {@link ScannerSettings.maximum_concurrent_signal_orders}
   * and {@link ScannerSettings.maximum_daily_signal_orders} and is no longer
   * consulted by the automatic-order path.
   */
  maximum_active_signal_orders: number;
  /**
   * Ceiling (0-10) on how many automatic orders may be OCCUPIED at once (queued,
   * in flight or acknowledged and unresolved). Never a quota: nothing is ever
   * ordered to reach it.
   */
  maximum_concurrent_signal_orders: number;
  /**
   * Ceiling (0-25) on how many automatic orders may be created per UTC day.
   * Subordinate to the daily setup cap, risk per trade, lot ceiling, exposure
   * limit and pre-send revalidation.
   */
  maximum_daily_signal_orders: number;
  /**
   * Owner opt-in: submit an eligible order immediately at MARKET while the live
   * price remains within the maximum acceptable entry. Off by default. It never
   * widens the slippage ceiling.
   */
  auto_market_entry_enabled: boolean;
  /**
   * Owner opt-in: while the intelligence gate is on, allow a setup whose regime
   * has too FEW resolved replay samples to be judged. A measured rate that is
   * below the threshold still refuses. Off by default.
   */
  allow_unmeasured_intel: boolean;
  /**
   * How long after DETECTION a published setup may still become an automatic
   * order, in minutes (0-360, default 180). 0 disables automatic orders on age
   * grounds. Independent of the structural {@link ORDER_TIF_MINUTES} used by
   * replay, shadow and research mathematics.
   */
  auto_order_window_minutes: number;
  /**
   * How many automatic orders ONE instrument may consume per UTC day (0-25).
   * Default 25 is a no-op against the daily ceiling; lowering it stops a single
   * symbol from spending the whole day's allowance.
   */
  maximum_daily_orders_per_symbol: number;
  /**
   * Owner opt-in: move the effective daily and per-symbol ceilings with broker
   * data freshness. Off by default, in which case the fixed ceilings apply.
   */
  adaptive_order_ceilings_enabled: boolean;
  /** Upper bound adaptive mode may raise a ceiling to when freshness is healthy. */
  adaptive_order_ceiling_max: number;
  /** Lower bound adaptive mode reduces to when freshness is degraded or unknown. */
  adaptive_order_ceiling_floor: number;
  /**
   * Max acceptable live spread at entry in pips. 0 disables the check.
   * A positive value is a hard pre-send gate on automatic orders.
   */
  max_entry_spread_pips: number;
  /**
   * Max tolerated slippage versus the published entry price in pips. 0 disables.
   */
  max_entry_slippage_pips: number;
  /**
   * Advisory/toggle-enforced ceiling on total open signal exposure as a percent
   * of account equity. Default 10; only enforced when exposure_limit_enabled is on.
   */
  max_total_exposure_percent: number;
  /**
   * Owner drawdown brakes. Every value is measured from CLOSED broker trades and
   * the broker's own equity reading; they stop NEW automatic orders only, and an
   * unmeasurable brake holds rather than passes. 0 disables an individual limit,
   * and the switch alone brakes nothing.
   */
  drawdown_brakes_enabled: boolean;
  /** Closed loss since 00:00 UTC as a percent of broker equity. 0 disables. */
  daily_loss_limit_percent: number;
  /** Closed loss since Monday 00:00 UTC as a percent of broker equity. 0 disables. */
  weekly_loss_limit_percent: number;
  /** Losing closed trades in a row, counted back from the last close. 0 disables. */
  consecutive_loss_limit: number;
  /** Equity drop from the highest OBSERVED equity, in percent. 0 disables. */
  max_drawdown_percent: number;
  /**
   * Fail-closed news protection for new automatic entries. When true, an incomplete
   * or active high-impact news window suppresses the order.
   */
  news_block_new_entries: boolean;
  /** Minutes before a known high-impact event to start blocking new entries. */
  news_suppression_minutes_before: number;
  /** Minutes after a known high-impact event to keep blocking new entries. */
  news_suppression_minutes_after: number;
}

/**
 * Bounds for the automatic-order ceilings.
 *
 * The MAXIMA are what an owner is ALLOWED to configure, not what they get: the
 * defaults are unchanged and deliberately conservative. A high ceiling stops
 * being the binding limit — the broker's own pending-order and margin limits,
 * risk per trade, sessions, instruments and the intelligence gate all still
 * apply, and dispatch still drains one delivery per pass.
 */
export const CONCURRENT_ORDER_CEILING_MAX = 100;
export const CONCURRENT_ORDER_CEILING_DEFAULT = 3;
export const DAILY_ORDER_CEILING_MAX = 100;
export const DAILY_ORDER_CEILING_DEFAULT = 10;
/** Per-symbol daily ceiling. Absent ⇒ the widest supported value (a no-op). */
export const PER_SYMBOL_ORDER_CEILING_DEFAULT = 25;
export const PER_SYMBOL_ORDER_CEILING_MAX = 100;

/** Adaptive band bounds. The band can never exceed the daily ceiling maximum. */
export const ADAPTIVE_CEILING_MAX_DEFAULT = 25;
export const ADAPTIVE_CEILING_FLOOR_DEFAULT = 1;

function clampCeiling(value: unknown, fallback: number, max: number): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), 0), max);
}

/** Concurrent automatic-order ceiling (0-100). Absent ⇒ the default, never 0. */
export function clampConcurrentOrderCeiling(value: unknown): number {
  return clampCeiling(value, CONCURRENT_ORDER_CEILING_DEFAULT, CONCURRENT_ORDER_CEILING_MAX);
}

/** Daily automatic-order ceiling (0-100). Absent ⇒ the default, never 0. */
export function clampDailyOrderCeiling(value: unknown): number {
  return clampCeiling(value, DAILY_ORDER_CEILING_DEFAULT, DAILY_ORDER_CEILING_MAX);
}

/** Per-symbol daily ceiling (0-100). Absent ⇒ the permissive default. */
export function clampPerSymbolOrderCeiling(value: unknown): number {
  return clampCeiling(value, PER_SYMBOL_ORDER_CEILING_DEFAULT, PER_SYMBOL_ORDER_CEILING_MAX);
}

/** Adaptive upper bound (0-100). Absent ⇒ the permissive default. */
export function clampAdaptiveCeilingMax(value: unknown): number {
  return clampCeiling(value, ADAPTIVE_CEILING_MAX_DEFAULT, DAILY_ORDER_CEILING_MAX);
}

/** Adaptive lower bound (0-100). Absent ⇒ 1. */
export function clampAdaptiveCeilingFloor(value: unknown): number {
  return clampCeiling(value, ADAPTIVE_CEILING_FLOOR_DEFAULT, DAILY_ORDER_CEILING_MAX);
}

export type OrderStrategy = "smart_adaptive" | "strict_retest";
export type WebhookFormat = "json" | "pineconnector";

/**
 * Structural time-in-force for the GRADED plan: two M15 candles. Replay, shadow
 * resolution and research mathematics are pinned to this constant so historical
 * research stays comparable. It is NOT the automatic-order window — see
 * `AUTO_ORDER_WINDOW_*` below, which each owner configures.
 */
export const ORDER_TIF_MINUTES = 30;

/**
 * How long after detection P-Trades may still place an AUTOMATIC order, per
 * owner. Default three hours; anything from 0 (never place an automatic order on
 * age grounds) to six hours is allowed. A longer window means acting on an older
 * structure — every other safety gate still applies unchanged.
 */
export const AUTO_ORDER_WINDOW_DEFAULT_MINUTES = 180;
export const AUTO_ORDER_WINDOW_MAX_MINUTES = 360;
export const AUTO_ORDER_WINDOW_MIN_MINUTES = 0;

/**
 * Clamps any stored or supplied window into the supported range. An absent value
 * means "not configured" and yields the default — never 0, which would silently
 * switch automatic orders off.
 */
export function clampAutoOrderWindowMinutes(value: unknown): number {
  if (value === null || value === undefined || value === "") {
    return AUTO_ORDER_WINDOW_DEFAULT_MINUTES;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return AUTO_ORDER_WINDOW_DEFAULT_MINUTES;
  return Math.min(
    Math.max(Math.round(n), AUTO_ORDER_WINDOW_MIN_MINUTES),
    AUTO_ORDER_WINDOW_MAX_MINUTES,
  );
}

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

/**
 * Display names for every instrument the registry knows about, including pairs
 * still in measurement — a label is safe to know, offering the pair is not.
 */
export const INSTRUMENT_LABELS: Record<string, string> = instrumentLabels();

/**
 * Fail-closed instrument list: what the settings UI offers when lifecycle stages
 * cannot be read at all. Wave 0 only, so a lifecycle outage can never silently
 * offer a pair that has not completed its gates.
 */
export const ALL_INSTRUMENTS: string[] = [...WAVE0_SYMBOLS];

/** How the terminal describes an instrument to the user. */
export type InstrumentCapability = "publishable" | "measuring" | "unavailable";

/**
 * The instruments a user may select, derived from lifecycle stage rather than a
 * frozen constant: a pair appears the moment it is legitimately promoted to a
 * publishing stage, and never before. An unreadable/empty stage read falls back
 * to Wave 0.
 */
export function publishableInstruments(
  stages: ReadonlyArray<{ symbol: string; stage: string }> | null | undefined,
): string[] {
  if (!stages || stages.length === 0) return [...ALL_INSTRUMENTS];
  const allowed = new Set(
    stages.filter((r) => isStage(r.stage) && mayPublish(r.stage)).map((r) => r.symbol),
  );
  return REGISTRY_SYMBOLS.filter((s) => allowed.has(s));
}

/**
 * What an instrument is allowed to do for the user, independent of whether its
 * broker feed is currently reachable. `measuring` means the scanner studies it
 * but nothing it produces may reach a feed, an alert or an order.
 */
export function instrumentCapability(
  symbol: string,
  stages: ReadonlyArray<{ symbol: string; stage: string }> | null | undefined,
): InstrumentCapability {
  const raw = stages?.find((r) => r.symbol === symbol)?.stage;
  if (!isStage(raw)) {
    return WAVE0_SYMBOLS.includes(symbol) ? "publishable" : "unavailable";
  }
  if (mayPublish(raw)) return "publishable";
  if (mayScan(raw)) return "measuring";
  return "unavailable";
}
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
