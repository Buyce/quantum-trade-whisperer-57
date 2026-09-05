/**
 * Drawdown brakes: broker-derived loss limits that pause AUTOMATIC orders.
 *
 * Reduce-only, and measurement-bound. Every input here is either owner-configured
 * (the limits) or broker-derived (a closed trade's realised money, a broker equity
 * reading). Nothing is estimated: an open position contributes nothing, a journal
 * entry contributes nothing, and a limit that cannot be measured refuses rather
 * than passing quietly — an account P-Trades cannot read is not a healthy account.
 *
 * A brake stops NEW orders only. An order already at the broker is never touched
 * by anything in this file; unwinding a live position is the owner's decision at
 * their broker.
 *
 * Pure: no fetch, no clock of its own, no database.
 */

export interface BrakeLimits {
  enabled: boolean;
  /** Realised loss for the UTC day, as a percent of equity. 0 disables. */
  dailyLossPercent: number;
  /** Realised loss for the ISO week, as a percent of equity. 0 disables. */
  weeklyLossPercent: number;
  /** Consecutive closed losing trades. 0 disables. */
  consecutiveLosses: number;
  /** Peak-to-current equity drawdown, as a percent of the peak. 0 disables. */
  maxDrawdownPercent: number;
}

const clampPercent = (value: unknown, cap = 100): number => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, cap);
};

const clampCount = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), 1_000);
};

export function readBrakeLimits(row: {
  drawdown_brakes_enabled?: boolean | null;
  daily_loss_limit_percent?: number | null;
  weekly_loss_limit_percent?: number | null;
  consecutive_loss_limit?: number | null;
  max_drawdown_percent?: number | null;
}): BrakeLimits {
  return {
    enabled: row.drawdown_brakes_enabled === true,
    dailyLossPercent: clampPercent(row.daily_loss_limit_percent),
    weeklyLossPercent: clampPercent(row.weekly_loss_limit_percent),
    consecutiveLosses: clampCount(row.consecutive_loss_limit),
    maxDrawdownPercent: clampPercent(row.max_drawdown_percent),
  };
}

/** Is any brake actually configured? Nobody pays for a feature they left off. */
export function brakesConfigured(limits: BrakeLimits): boolean {
  return (
    limits.enabled &&
    (limits.dailyLossPercent > 0 ||
      limits.weeklyLossPercent > 0 ||
      limits.consecutiveLosses > 0 ||
      limits.maxDrawdownPercent > 0)
  );
}

/** One closed broker trade, exactly as the broker settled it. */
export interface ClosedTrade {
  /** Millisecond timestamp of the close. */
  exitAtMs: number;
  /** Gross profit + commission + swap, in the account's profit currency. */
  net: number;
  currency: string | null;
}

export interface RealisedTotals {
  dayUtc: string;
  dayRealized: number;
  weekStartUtc: string;
  weekRealized: number;
  consecutiveLosses: number;
  currency: string | null;
  sample: number;
}

/** ISO-week Monday, as a UTC date string. */
export function isoWeekStartUtc(nowMs: number): string {
  const d = new Date(nowMs);
  const dow = d.getUTCDay(); // 0 = Sunday
  const back = dow === 0 ? 6 : dow - 1;
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back);
  return new Date(monday).toISOString().slice(0, 10);
}

export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Realised money for the UTC day and the ISO week, plus the current run of
 * consecutive losing closes.
 *
 * "Realised" means settled and closed. A break-even close (net exactly 0) ends a
 * losing run without being counted as a loss — it is neither.
 */
export function summariseRealised(trades: readonly ClosedTrade[], nowMs: number): RealisedTotals {
  const dayUtc = utcDay(nowMs);
  const weekStartUtc = isoWeekStartUtc(nowMs);
  const weekStartMs = Date.parse(`${weekStartUtc}T00:00:00.000Z`);

  let dayRealized = 0;
  let weekRealized = 0;
  let currency: string | null = null;

  const usable = trades
    .filter((t) => Number.isFinite(t.exitAtMs) && Number.isFinite(t.net))
    .slice()
    .sort((a, b) => a.exitAtMs - b.exitAtMs);

  for (const t of usable) {
    if (utcDay(t.exitAtMs) === dayUtc) dayRealized += t.net;
    if (t.exitAtMs >= weekStartMs) weekRealized += t.net;
    if (t.currency) currency = t.currency;
  }

  // Consecutive losses run backwards from the most recent close.
  let consecutiveLosses = 0;
  for (let i = usable.length - 1; i >= 0; i -= 1) {
    const net = usable[i]!.net;
    if (net < 0) consecutiveLosses += 1;
    else break;
  }

  return {
    dayUtc,
    dayRealized,
    weekStartUtc,
    weekRealized,
    consecutiveLosses,
    currency,
    sample: usable.length,
  };
}

export type BrakeReason =
  | "daily_loss_limit"
  | "weekly_loss_limit"
  | "consecutive_loss_limit"
  | "equity_drawdown_limit"
  | "risk_state_unmeasured";

export interface BrakeVerdict {
  paused: boolean;
  reason: BrakeReason | null;
  detail: string | null;
  /** When the brake lifts by itself. null means it needs the owner. */
  resumeAfterMs: number | null;
  resumeBoundary: "next_utc_day" | "next_iso_week" | "owner" | null;
}

const PASS: BrakeVerdict = {
  paused: false,
  reason: null,
  detail: null,
  resumeAfterMs: null,
  resumeBoundary: null,
};

const nextUtcDayMs = (nowMs: number): number => {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};

const nextIsoWeekMs = (nowMs: number): number =>
  Date.parse(`${isoWeekStartUtc(nowMs)}T00:00:00.000Z`) + 7 * 24 * 60 * 60 * 1000;

export interface BrakeInputs {
  totals: RealisedTotals | null;
  /** Broker-reported equity. null when the broker did not report one. */
  equity: number | null;
  /** Highest broker equity P-Trades has observed for this account. */
  peakEquity: number | null;
}

/**
 * Does any configured brake hold right now?
 *
 * The order is deliberate: the widest, longest-lasting brake is reported first, so
 * an owner sees the most serious reason rather than the first one alphabetically.
 */
export function evaluateBrakes(
  limits: BrakeLimits,
  inputs: BrakeInputs,
  nowMs: number,
): BrakeVerdict {
  if (!brakesConfigured(limits)) return PASS;

  const needsEquity =
    limits.dailyLossPercent > 0 || limits.weeklyLossPercent > 0 || limits.maxDrawdownPercent > 0;

  if (inputs.totals === null) {
    return {
      paused: true,
      reason: "risk_state_unmeasured",
      detail:
        "your closed broker trades could not be read, so your loss limits could not be checked. An account P-Trades cannot measure is not treated as a safe one.",
      resumeAfterMs: null,
      resumeBoundary: "owner",
    };
  }

  if (needsEquity && !(typeof inputs.equity === "number" && inputs.equity > 0)) {
    return {
      paused: true,
      reason: "risk_state_unmeasured",
      detail:
        "your broker did not report equity for this account, so your loss limits could not be expressed as a percentage of it. Equity is never assumed.",
      resumeAfterMs: null,
      resumeBoundary: "owner",
    };
  }

  const equity = inputs.equity ?? 0;
  const money = (n: number): string => `${n.toFixed(2)}${inputs.totals?.currency ? ` ${inputs.totals.currency}` : ""}`;

  // Peak-to-current equity drawdown. Only measurable once a higher equity has
  // actually been observed; a fresh account has no peak and no drawdown claim.
  if (limits.maxDrawdownPercent > 0) {
    const peak = inputs.peakEquity;
    if (typeof peak === "number" && peak > 0 && equity < peak) {
      const drawdown = ((peak - equity) / peak) * 100;
      if (drawdown >= limits.maxDrawdownPercent) {
        return {
          paused: true,
          reason: "equity_drawdown_limit",
          detail: `equity is ${drawdown.toFixed(2)}% below the highest equity P-Trades has observed on this account (${money(peak)}), at or past your ${limits.maxDrawdownPercent}% drawdown limit. This one does not lift by itself.`,
          resumeAfterMs: null,
          resumeBoundary: "owner",
        };
      }
    }
  }

  if (limits.weeklyLossPercent > 0) {
    const loss = -inputs.totals.weekRealized;
    if (loss > 0) {
      const pct = (loss / equity) * 100;
      if (pct >= limits.weeklyLossPercent) {
        return {
          paused: true,
          reason: "weekly_loss_limit",
          detail: `closed broker trades this week are down ${money(loss)}, ${pct.toFixed(2)}% of equity, at or past your ${limits.weeklyLossPercent}% weekly limit. Automatic orders resume next Monday 00:00 UTC.`,
          resumeAfterMs: nextIsoWeekMs(nowMs),
          resumeBoundary: "next_iso_week",
        };
      }
    }
  }

  if (limits.dailyLossPercent > 0) {
    const loss = -inputs.totals.dayRealized;
    if (loss > 0) {
      const pct = (loss / equity) * 100;
      if (pct >= limits.dailyLossPercent) {
        return {
          paused: true,
          reason: "daily_loss_limit",
          detail: `closed broker trades today are down ${money(loss)}, ${pct.toFixed(2)}% of equity, at or past your ${limits.dailyLossPercent}% daily limit. Automatic orders resume at 00:00 UTC.`,
          resumeAfterMs: nextUtcDayMs(nowMs),
          resumeBoundary: "next_utc_day",
        };
      }
    }
  }

  if (limits.consecutiveLosses > 0 && inputs.totals.consecutiveLosses >= limits.consecutiveLosses) {
    return {
      paused: true,
      reason: "consecutive_loss_limit",
      detail: `the last ${inputs.totals.consecutiveLosses} closed broker trades on this account were all losses, at or past your limit of ${limits.consecutiveLosses}. Automatic orders resume at 00:00 UTC.`,
      resumeAfterMs: nextUtcDayMs(nowMs),
      resumeBoundary: "next_utc_day",
    };
  }

  return PASS;
}

/** Plain-language wording for a persisted pause, for the queue and the UI. */
export const BRAKE_REASON_COPY: Record<BrakeReason, string> = {
  daily_loss_limit: "Your daily loss limit was reached on closed broker trades.",
  weekly_loss_limit: "Your weekly loss limit was reached on closed broker trades.",
  consecutive_loss_limit: "Your consecutive-losing-trades limit was reached.",
  equity_drawdown_limit: "Your account drawdown limit was reached against the highest equity observed.",
  risk_state_unmeasured:
    "Your loss limits could not be measured from your broker, so automatic orders are held rather than allowed through unchecked.",
};
