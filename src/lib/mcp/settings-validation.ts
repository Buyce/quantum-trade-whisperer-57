/**
 * Shared validator for agent-driven settings writes.
 *
 * The web UI and the MCP tools must not be able to diverge on what a legal
 * setting is, so every bound lives here. Values are clamped rather than
 * silently accepted: an agent asking for 500% risk gets 10%, and is told so.
 */
export const INSTRUMENT_CHOICES = ["XAUUSD", "GBPAUD", "EURUSD"] as const;
export const TIMEFRAME_CHOICES = ["H4", "H1", "M15"] as const;
export const SESSION_CHOICES = [
  "sydney",
  "tokyo",
  "london",
  "london_new_york_overlap",
  "new_york",
] as const;
export const GRADE_CHOICES = ["A+", "A", "B", "C"] as const;
export const CURRENCY_CHOICES = ["USD", "EUR", "GBP", "AUD"] as const;

/**
 * Explains, in the tool result itself, why a `timeframes` write did nothing.
 * Exported so the tool description, the deprecation test and the assistant all
 * quote the same sentence.
 */
export const DEPRECATED_TIMEFRAMES_WARNING =
  "timeframes is deprecated and was not applied: every setup is a single multi-timeframe structure covering H4, H1 and M15, so timeframes are not a filter.";

export interface SettingsInput {
  instruments?: string[] | undefined;
  /** @deprecated Accepted for compatibility, never written. See DEPRECATED_TIMEFRAMES_WARNING. */
  timeframes?: string[] | undefined;

  sessions?: string[] | undefined;
  min_grade?: string | undefined;
  alert_min_grade?: string | undefined;
  daily_setup_cap?: number | undefined;
  notify_push?: boolean | undefined;
  notify_email?: boolean | undefined;
  account_equity?: number | undefined;
  account_currency?: string | undefined;
  risk_per_trade_percent?: number | undefined;
  max_position_size?: number | undefined;
  leverage?: number | undefined;
  max_stop_loss_percent?: number | undefined;
  /** Explicit, persisted acknowledgement for risking more than 2% per trade. */
  risk_ack_high?: boolean | undefined;
}

/**
 * Conservative default risk. Anything above this needs a persisted high-risk
 * acknowledgement — the number is not silently accepted.
 */
export const CONSERVATIVE_RISK_PERCENT = 1;
export const HIGH_RISK_THRESHOLD_PERCENT = 2;

/**
 * Money-moving fields. Changing any of these changes how large a real position
 * the user will take, so an agent must carry the user's explicit approval
 * (`confirm_risk_change: true`) before it may write them. Clamping and validation
 * still apply on top of the confirmation — approval is not a bypass.
 */
export const SENSITIVE_RISK_FIELDS = [
  "account_equity",
  "account_currency",
  "risk_per_trade_percent",
  "max_position_size",
  "leverage",
  "max_stop_loss_percent",
  "risk_ack_high",
] as const;

export type SensitiveRiskField = (typeof SENSITIVE_RISK_FIELDS)[number];

/** Sensitive fields present in the input, in declaration order. */
export function sensitiveFieldsIn(input: SettingsInput): SensitiveRiskField[] {
  return SENSITIVE_RISK_FIELDS.filter((f) => input[f] !== undefined);
}

export interface ValidateOptions {
  /** The acknowledgement already stored for this user. */
  currentAckHigh?: boolean;
  /** The risk percent already stored for this user. */
  currentRiskPercent?: number | null;
  /** Timestamp written alongside a new entered balance. */
  now?: Date;
}

export interface ValidatedSettings {
  patch: Record<string, unknown>;
  warnings: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function filterList(
  values: string[],
  allowed: readonly string[],
  label: string,
  warnings: string[],
): string[] | null {
  const kept = values.filter((v) => allowed.includes(v));
  const dropped = values.filter((v) => !allowed.includes(v));
  if (dropped.length) warnings.push(`Ignored unknown ${label}: ${dropped.join(", ")}.`);
  if (kept.length === 0) {
    warnings.push(`${label} left unchanged: at least one valid value is required.`);
    return null;
  }
  return Array.from(new Set(kept));
}

/** Builds a safe database patch from agent-supplied settings. */
export function validateSettings(
  input: SettingsInput,
  options: ValidateOptions = {},
): ValidatedSettings {
  const patch: Record<string, unknown> = {};
  const warnings: string[] = [];

  if (input.instruments) {
    const v = filterList(input.instruments, INSTRUMENT_CHOICES, "instruments", warnings);
    if (v) patch["instruments"] = v;
  }
  // `timeframes` is deprecated, not merely unused. Every published setup is a
  // single multi-timeframe structure spanning H4, H1 and M15, and no eligibility
  // path has ever read this field — so accepting a write would leave the agent
  // believing it had applied a filter that does not exist. It is refused loudly
  // and never written; the column stays dormant for backwards compatibility.
  if (input.timeframes) {
    warnings.push(DEPRECATED_TIMEFRAMES_WARNING);
  }

  if (input.sessions) {
    const v = filterList(input.sessions, SESSION_CHOICES, "sessions", warnings);
    if (v) patch["sessions"] = v;
  }

  for (const key of ["min_grade", "alert_min_grade"] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (!GRADE_CHOICES.includes(value as (typeof GRADE_CHOICES)[number])) {
      warnings.push(`${key} left unchanged: must be one of ${GRADE_CHOICES.join(", ")}.`);
      continue;
    }
    patch[key] = value;
  }

  if (input.daily_setup_cap !== undefined) {
    const cap = Math.round(clamp(input.daily_setup_cap, 0, 500));
    if (cap !== input.daily_setup_cap) warnings.push(`daily_setup_cap clamped to ${cap}.`);
    patch["daily_setup_cap"] = cap;
  }

  if (input.risk_ack_high !== undefined) patch["risk_ack_high"] = input.risk_ack_high;

  if (input.notify_push !== undefined) patch["notify_push"] = input.notify_push;
  if (input.notify_email !== undefined) patch["notify_email"] = input.notify_email;

  if (input.account_currency !== undefined) {
    const cur = input.account_currency.toUpperCase();
    if (!CURRENCY_CHOICES.includes(cur as (typeof CURRENCY_CHOICES)[number])) {
      warnings.push(
        `account_currency left unchanged: must be one of ${CURRENCY_CHOICES.join(", ")}.`,
      );
    } else {
      patch["account_currency"] = cur;
    }
  }

  const numeric: Array<[keyof SettingsInput, string, number, number]> = [
    ["account_equity", "account_equity", 0, 100_000_000],
    ["risk_per_trade_percent", "risk_per_trade_percent", 0.1, 10],
    ["max_position_size", "max_position_size", 0, 1_000],
    ["leverage", "leverage", 1, 500],
    ["max_stop_loss_percent", "max_stop_loss_percent", 0, 100],
  ];
  for (const [key, column, min, max] of numeric) {
    const value = input[key] as number | undefined;
    if (value === undefined) continue;
    if (!Number.isFinite(value)) {
      warnings.push(`${column} left unchanged: not a finite number.`);
      continue;
    }
    const clamped =
      column === "leverage" ? Math.round(clamp(value, min, max)) : clamp(value, min, max);
    if (clamped !== value) warnings.push(`${column} clamped to ${clamped}.`);
    patch[column] = clamped;
  }

  // Above-2% risk requires an explicit, persisted acknowledgement. Without it
  // the percent is left unchanged rather than quietly applied.
  const requestedRisk = patch["risk_per_trade_percent"] as number | undefined;
  if (requestedRisk !== undefined && requestedRisk > HIGH_RISK_THRESHOLD_PERCENT) {
    const acknowledged = input.risk_ack_high === true || options.currentAckHigh === true;
    if (!acknowledged) {
      delete patch["risk_per_trade_percent"];
      warnings.push(
        `risk_per_trade_percent left unchanged: risking more than ${HIGH_RISK_THRESHOLD_PERCENT}% per trade requires an explicit high-risk acknowledgement (risk_ack_high: true). The conservative default is ${CONSERVATIVE_RISK_PERCENT}%.`,
      );
    } else {
      patch["risk_ack_high"] = true;
      warnings.push(
        `Risking ${requestedRisk}% per trade is above the ${HIGH_RISK_THRESHOLD_PERCENT}% conventional ceiling; the acknowledgement has been recorded.`,
      );
    }
  }

  // Persistent invariant: risk above the threshold can never coexist with a
  // cleared acknowledgement. Clearing it is only allowed when the same atomic
  // update also brings the risk down to the threshold or below.
  if (patch["risk_ack_high"] === false) {
    const effectiveRisk =
      (patch["risk_per_trade_percent"] as number | undefined) ?? options.currentRiskPercent ?? null;
    if (effectiveRisk !== null && effectiveRisk > HIGH_RISK_THRESHOLD_PERCENT) {
      delete patch["risk_ack_high"];
      warnings.push(
        `risk_ack_high left unchanged: it cannot be cleared while risk_per_trade_percent is ${effectiveRisk}% (above ${HIGH_RISK_THRESHOLD_PERCENT}%). Lower the risk to ${HIGH_RISK_THRESHOLD_PERCENT}% or less in the same update to withdraw the acknowledgement.`,
      );
    }
  }

  // Provenance: a new entered balance is timestamped so staleness is visible.
  // P-Trades never reads equity from the broker, so this is user-entered only.
  if (patch["account_equity"] !== undefined) {
    patch["equity_as_of"] = (options.now ?? new Date()).toISOString();
  }

  return { patch, warnings };
}
