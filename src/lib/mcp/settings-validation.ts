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

export interface SettingsInput {
  instruments?: string[] | undefined;
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
export function validateSettings(input: SettingsInput): ValidatedSettings {
  const patch: Record<string, unknown> = {};
  const warnings: string[] = [];

  if (input.instruments) {
    const v = filterList(input.instruments, INSTRUMENT_CHOICES, "instruments", warnings);
    if (v) patch["instruments"] = v;
  }
  if (input.timeframes) {
    const v = filterList(input.timeframes, TIMEFRAME_CHOICES, "timeframes", warnings);
    if (v) patch["timeframes"] = v;
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

  return { patch, warnings };
}
