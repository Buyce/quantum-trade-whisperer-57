/**
 * Position-size and risk calculator.
 *
 * Pure, client-side, and derived entirely from the stored setup plus the user's
 * own risk profile. It never touches the scanner, the grade, or the alert path:
 * changing a risk setting changes only what the card tells you to size.
 *
 * ZERO-HALLUCINATION: every function returns an explicit "unavailable" reason
 * rather than a plausible-looking number. A missing FX conversion rate or an
 * unset account equity produces no lot size at all.
 */

/** Instrument contract specifications, as quoted by the broker. */
export interface ContractSpec {
  /** Units of the base currency in one standard lot. */
  contractSize: number;
  base: string;
  /** Currency the price — and therefore the raw risk — is denominated in. */
  quote: string;
  /** Smallest tradable increment in lots. */
  lotStep: number;
  minLot: number;
}

export const CONTRACT_SPECS: Record<string, ContractSpec> = {
  // Gold is quoted per troy ounce; one lot is 100oz.
  XAUUSD: { contractSize: 100, base: "XAU", quote: "USD", lotStep: 0.01, minLot: 0.01 },
  EURUSD: { contractSize: 100_000, base: "EUR", quote: "USD", lotStep: 0.01, minLot: 0.01 },
  // Cross pair: risk lands in AUD, so an account in USD needs an AUDUSD rate.
  GBPAUD: { contractSize: 100_000, base: "GBP", quote: "AUD", lotStep: 0.01, minLot: 0.01 },
};

export interface RiskProfile {
  accountEquity: number;
  accountCurrency: string;
  riskPerTradePercent: number;
  /** Hard lot ceiling. 0 disables the cap. */
  maxPositionSize: number;
  leverage: number;
  /** Maximum stop distance as a percent of entry. 0 disables the check. */
  maxStopLossPercent: number;
}

export const DEFAULT_RISK_PROFILE: RiskProfile = {
  accountEquity: 0,
  accountCurrency: "USD",
  riskPerTradePercent: 1,
  maxPositionSize: 0,
  leverage: 100,
  maxStopLossPercent: 0,
};

export type RiskUnavailableReason =
  | "no_equity"
  | "no_spec"
  | "no_conversion_rate"
  | "invalid_stop"
  /** Broker-confirmed minimum stop distance is wider than this setup's stop. */
  | "below_stops_level"
  /** Live quote used for conversion is older than the caller's freshness bound. */
  | "stale_quote"
  /** Broker spec exists but is older than its freshness bound. */
  | "stale_spec";

export interface RiskUnavailable {
  ok: false;
  reason: RiskUnavailableReason;
}

export interface RiskBreakdown {
  ok: true;
  currency: string;
  /** Currency the raw per-lot risk is denominated in before conversion. */
  quoteCurrency: string;
  /** Value of one unit of the quote currency in the account currency. */
  conversionRate: number;
  /** Budgeted loss at 1R, from equity x risk%. */
  riskBudget: number;
  stopDistance: number;
  /** Stop distance as a percentage of entry price. */
  stopPercent: number;
  /** Loss in account currency if one full lot is stopped out. */
  riskPerLot: number;
  /** Size the budget alone implies, before any cap or rounding. */
  rawLots: number;
  /** Tradable size: capped, then floored to the broker's lot step. */
  lots: number;
  /** Actual money at risk at `lots`, which rounding makes <= riskBudget. */
  riskAmount: number;
  riskPercentOfEquity: number;
  /** Position value in account currency. */
  notional: number;
  marginRequired: number;
  marginPercentOfEquity: number;
  /** Profit at the furthest reachable target, at `lots`. */
  rewardAtFinalTarget: number | null;
  finalTargetR: number | null;
  /** Set when the lot ceiling, not the risk budget, decided the size. */
  cappedByPositionSize: boolean;
  /** Budget is too small to open even the minimum lot. */
  belowMinimumLot: boolean;
  /** Margin for this size exceeds account equity at the configured leverage. */
  exceedsMargin: boolean;
  /** Stop is wider than the user's configured ceiling. */
  exceedsStopCeiling: boolean;
}

export type RiskResult = RiskBreakdown | RiskUnavailable;

/** Floor to a lot step so the size is always tradable and never rounds risk up. */
function floorToStep(lots: number, step: number): number {
  if (step <= 0) return lots;
  return Math.floor(lots / step + 1e-9) * step;
}

export interface RiskInput {
  instrument: string;
  entryPrice: number;
  stopLoss: number;
  /** R multiple of the furthest reachable target, when known. */
  finalTargetR?: number | null;
}

/**
 * Rate converting one unit of `quote` into `accountCurrency`.
 * Returns null when the pair needs a rate we do not have — the caller must then
 * show "unavailable" rather than assuming parity.
 */
export function conversionRate(
  quote: string,
  accountCurrency: string,
  rates: Record<string, number>,
): number | null {
  if (quote === accountCurrency) return 1;
  // Direct quote, e.g. AUD -> USD via AUDUSD.
  const direct = rates[`${quote}${accountCurrency}`];
  if (direct && Number.isFinite(direct) && direct > 0) return direct;
  // Inverse quote, e.g. USD -> AUD via AUDUSD.
  const inverse = rates[`${accountCurrency}${quote}`];
  if (inverse && Number.isFinite(inverse) && inverse > 0) return 1 / inverse;
  return null;
}

/**
 * @param rates FX pairs keyed as concatenated symbols (e.g. `AUDUSD`), used only
 *   to convert quote-currency risk into the account currency.
 */
export function calculateRisk(
  input: RiskInput,
  profile: RiskProfile,
  rates: Record<string, number> = {},
): RiskResult {
  const spec = CONTRACT_SPECS[input.instrument];
  if (!spec) return { ok: false, reason: "no_spec" };
  if (!(profile.accountEquity > 0)) return { ok: false, reason: "no_equity" };

  const entry = Number(input.entryPrice);
  const stopDistance = Math.abs(entry - Number(input.stopLoss));
  if (!(stopDistance > 0) || !(entry > 0)) return { ok: false, reason: "invalid_stop" };

  const rate = conversionRate(spec.quote, profile.accountCurrency, rates);
  if (rate === null) return { ok: false, reason: "no_conversion_rate" };

  const riskBudget = profile.accountEquity * (profile.riskPerTradePercent / 100);
  const riskPerLot = stopDistance * spec.contractSize * rate;
  const rawLots = riskBudget / riskPerLot;

  const ceiling = profile.maxPositionSize > 0 ? profile.maxPositionSize : Infinity;
  const cappedRaw = Math.min(rawLots, ceiling);
  const lots = Math.max(0, floorToStep(cappedRaw, spec.lotStep));
  const belowMinimumLot = lots < spec.minLot;

  const riskAmount = lots * riskPerLot;
  // Price of one base unit in the account currency: entry is quote-denominated.
  const notional = lots * spec.contractSize * entry * rate;
  const leverage = profile.leverage > 0 ? profile.leverage : 1;
  const marginRequired = notional / leverage;

  const finalTargetR =
    input.finalTargetR != null && Number.isFinite(input.finalTargetR)
      ? Number(input.finalTargetR)
      : null;

  return {
    ok: true,
    currency: profile.accountCurrency,
    quoteCurrency: spec.quote,
    conversionRate: rate,
    riskBudget,
    stopDistance,
    stopPercent: (stopDistance / entry) * 100,
    riskPerLot,
    rawLots,
    lots,
    riskAmount,
    riskPercentOfEquity: (riskAmount / profile.accountEquity) * 100,
    notional,
    marginRequired,
    marginPercentOfEquity: (marginRequired / profile.accountEquity) * 100,
    rewardAtFinalTarget: finalTargetR === null ? null : riskAmount * finalTargetR,
    finalTargetR,
    cappedByPositionSize: rawLots > ceiling,
    belowMinimumLot,
    exceedsMargin: marginRequired > profile.accountEquity,
    exceedsStopCeiling:
      profile.maxStopLossPercent > 0 && (stopDistance / entry) * 100 > profile.maxStopLossPercent,
  };
}

export const RISK_UNAVAILABLE_COPY: Record<RiskUnavailableReason, string> = {
  no_equity: "Add your account balance in Settings → Risk to size this setup.",
  no_spec: "No contract specification for this instrument, so size cannot be calculated.",
  no_conversion_rate:
    "Live FX rate needed to convert this pair's risk into your account currency is unavailable.",
  invalid_stop: "This setup has no usable stop distance.",
};

/** Currencies an account may be denominated in. */
export const ACCOUNT_CURRENCIES = ["USD", "EUR", "GBP", "AUD"] as const;

/**
 * Money formatting that keeps small balances honest: lot sizes and cash both
 * matter to two decimals for a retail account.
 */
export function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/**
 * Reads a risk profile off the user's settings row, falling back to the
 * defaults while the row is still loading. Numeric columns arrive as strings
 * from PostgREST for `numeric`, so each is coerced explicitly.
 */
export function riskProfileFromSettings(
  settings:
    | {
        account_equity?: number | string | null;
        account_currency?: string | null;
        risk_per_trade_percent?: number | string | null;
        max_position_size?: number | string | null;
        leverage?: number | string | null;
        max_stop_loss_percent?: number | string | null;
      }
    | null
    | undefined,
): RiskProfile {
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  if (!settings) return DEFAULT_RISK_PROFILE;
  return {
    accountEquity: num(settings.account_equity, 0),
    accountCurrency: settings.account_currency || "USD",
    riskPerTradePercent: num(settings.risk_per_trade_percent, 1),
    maxPositionSize: num(settings.max_position_size, 0),
    leverage: num(settings.leverage, 100),
    maxStopLossPercent: num(settings.max_stop_loss_percent, 0),
  };
}
