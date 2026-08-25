/**
 * Bounded spread sampler — the PURE half (Phase A2 operational telemetry).
 *
 * Everything here is deterministic and side-effect free so the classification
 * rules that decide whether a measurement is evidence can be asserted in tests
 * without a broker, a clock or a database.
 *
 * WHAT THIS MODULE REFUSES TO DO
 *   - It never invents a spread. A closed market, a missing broker timestamp or a
 *     crossed quote produces a CLASSIFIED attempt, not a number.
 *   - It never converts to "pips" for an instrument whose broker `point` is
 *     unknown; an unknown unit is reported as null rather than assumed.
 *   - It never fetches candle history. Volatility context comes from an ATR
 *     snapshot the scanner already produced from candles it had already fetched.
 */

import type { AssetClass } from "@/lib/instruments/registry";

/** Bump ONLY when the sampling procedure itself changes meaning. */
export const SAMPLER_VERSION = 1 as const;

/** One scheduled slot every 15 minutes, aligned to the scan cadence. */
export const SAMPLER_INTERVAL_MS = 15 * 60_000;

/**
 * Hard per-run ceilings. The database `telemetry_controls` row may LOWER these;
 * it may never raise them, so a mistaken settings edit cannot spend an unbounded
 * provider budget.
 */
export const MAX_INSTRUMENTS_PER_RUN = 3;
export const MAX_REQUESTS_PER_RUN = 6;

/**
 * Freshness bound for a MEASUREMENT.
 *
 * Deliberately separate from the pre-send execution gate: a telemetry sample that
 * is two minutes old is still honest evidence about spread conditions, while an
 * order must be priced far more tightly. Sharing one constant would tempt a later
 * change in one place to loosen the other.
 */
export const SAMPLE_QUOTE_MAX_AGE_MS = 120_000;

/** Tolerated broker clock lead before a timestamp is unusable. */
export const SAMPLE_FUTURE_SKEW_MS = 30_000;

/** An ATR snapshot older than this is not volatility context for "now". */
export const ATR_SNAPSHOT_MAX_AGE_MS = 90 * 60_000;

export type SampleQuality =
  | "valid"
  | "stale"
  | "future_dated"
  | "closed_market"
  | "malformed"
  | "inverted";

export type MarketState = "open" | "closed" | "unknown";

export interface QuoteClassification {
  quality: SampleQuality;
  /** Machine-readable reasons, always populated for a non-valid sample. */
  reasons: string[];
  marketState: MarketState;
}

export interface ClassifyInput {
  bid: number | null | undefined;
  ask: number | null | undefined;
  sourceTime: string | null | undefined;
  now: Date;
  /** Caller-supplied calendar fact; never inferred from the price itself. */
  marketClosed: boolean;
  maxAgeMs?: number;
}

/**
 * The one place a raw broker answer becomes either evidence or a classified
 * refusal. Order matters: a market-closed attempt is recorded as such even when
 * the quote is also stale, because the operational meaning is different.
 */
export function classifyQuote(input: ClassifyInput): QuoteClassification {
  const marketState: MarketState = input.marketClosed ? "closed" : "open";
  const reasons: string[] = [];
  const bid = Number(input.bid);
  const ask = Number(input.ask);
  const maxAgeMs = input.maxAgeMs ?? SAMPLE_QUOTE_MAX_AGE_MS;

  if (input.marketClosed) {
    return { quality: "closed_market", reasons: ["market_closed"], marketState };
  }

  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
    reasons.push("nonfinite_or_nonpositive_price");
    return { quality: "malformed", reasons, marketState };
  }
  if (ask < bid) {
    reasons.push("crossed_bid_ask");
    return { quality: "inverted", reasons, marketState };
  }
  if (ask === bid) {
    // A zero spread is not a tradable market answer; it is a broker artefact.
    reasons.push("zero_spread");
    return { quality: "malformed", reasons, marketState };
  }

  const parsed = input.sourceTime ? Date.parse(input.sourceTime) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    reasons.push("missing_or_unparseable_source_time");
    return { quality: "malformed", reasons, marketState };
  }

  const ageMs = input.now.getTime() - parsed;
  if (ageMs < -SAMPLE_FUTURE_SKEW_MS) {
    reasons.push("source_time_in_the_future");
    return { quality: "future_dated", reasons, marketState };
  }
  if (ageMs > maxAgeMs) {
    reasons.push("source_time_older_than_sampling_window");
    return { quality: "stale", reasons, marketState };
  }

  return { quality: "valid", reasons: [], marketState };
}

export interface SpreadMetricsInput {
  bid: number;
  ask: number;
  /** Broker SYMBOL_POINT. Null means the point unit is unknown, not 1. */
  point: number | null;
  digits: number | null;
  /**
   * Asset class (Wave 2). A pip is an FX convention: when the asset class is known
   * and is not FX, `spreadPips` is null rather than a re-labelled point count.
   * Omitting it keeps the pre-Wave-2 digit-based behaviour.
   */
  assetClass?: AssetClass | null;
  /** Scanner-derived ATR for volatility normalisation, or null when unavailable. */
  atr: number | null;
}

export interface SpreadMetrics {
  mid: number;
  spreadPrice: number;
  spreadPoints: number | null;
  spreadPips: number | null;
  spreadAtrFraction: number | null;
}

/** Five significant figures is plenty for a spread; it also stops float noise. */
function round(value: number, precision = 6): number {
  return Number(value.toPrecision(precision));
}

export function spreadMetrics(input: SpreadMetricsInput): SpreadMetrics {
  const spreadPrice = round(input.ask - input.bid);
  const mid = round((input.ask + input.bid) / 2);
  const point = input.point && input.point > 0 ? input.point : null;
  const spreadPoints = point ? round(spreadPrice / point) : null;
  // One pip is ten points on a 3- or 5-digit FX quote. Without broker digits the
  // pip is undefined, and an undefined unit is reported as such.
  const pipless = input.assetClass !== undefined && input.assetClass !== null && input.assetClass !== "fx";
  const pipSize = pipless
    ? null
    : point && (input.digits === 3 || input.digits === 5)
      ? point * 10
      : point && (input.digits === 2 || input.digits === 4)
        ? point
        : null;
  const spreadPips = pipSize ? round(spreadPrice / pipSize) : null;
  const spreadAtrFraction =
    input.atr && input.atr > 0 ? round(spreadPrice / input.atr, 5) : null;

  return { mid, spreadPrice, spreadPoints, spreadPips, spreadAtrFraction };
}

/** The scheduled slot a wall-clock instant belongs to, floored to the cadence. */
export function alignSlot(now: Date, intervalMs = SAMPLER_INTERVAL_MS): Date {
  return new Date(Math.floor(now.getTime() / intervalMs) * intervalMs);
}

/**
 * Provider-request budget for one scheduled day, computed rather than asserted:
 * one quote per instrument per slot, and nothing else. Candles are NOT sampled.
 */
export function dailyRequestBudget(
  instruments: number,
  intervalMs = SAMPLER_INTERVAL_MS,
): { slotsPerDay: number; instrumentSlotsPerDay: number; requestsPerDay: number } {
  const slotsPerDay = Math.floor((24 * 3_600_000) / intervalMs);
  const instrumentSlotsPerDay = slotsPerDay * instruments;
  return { slotsPerDay, instrumentSlotsPerDay, requestsPerDay: instrumentSlotsPerDay };
}
