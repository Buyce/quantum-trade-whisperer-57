/**
 * Candle-series validation (Phase A1, Finding 6).
 *
 * The old readiness check asked one question — "did enough candles come back?" —
 * which a broken series passes easily. A series can be long enough and still be
 * ungradable: out of order, duplicated, missing whole intervals, or carrying an
 * unfinished current bar whose high/low will still move.
 *
 * Pure and deterministic: no clock beyond the `now` you pass in, no fetch. Every
 * problem is reported as a named code so a promotion decision can cite it.
 */
import type { Candle, Timeframe } from "@/lib/scanner/types";

/** Nominal minutes per timeframe — the interval continuity check's yardstick. */
export const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  H4: 240,
  H1: 60,
  M15: 15,
};

export type SeriesProblem =
  | "empty"
  | "too_few"
  | "unparseable_timestamp"
  | "not_ascending"
  | "duplicate_timestamp"
  | "interval_gap"
  | "incomplete_current_candle"
  | "invalid_ohlc_geometry"
  | "non_finite_price"
  | "stale_series";

export interface SeriesFinding {
  problem: SeriesProblem;
  detail: string;
}

export interface SeriesReport {
  timeframe: Timeframe;
  count: number;
  required: number;
  ok: boolean;
  findings: SeriesFinding[];
  /** Timestamp of the newest candle, or null when unusable. */
  lastCandleAt: string | null;
  /** Whole missing intervals detected inside the returned window. */
  missingIntervals: number;
}

/**
 * A weekend/holiday gap is normal FX behaviour, so a gap is only reported when it
 * exceeds this multiple of the nominal interval AND does not straddle a weekend.
 */
const GAP_TOLERANCE_MULTIPLE = 1.5;

/**
 * A series whose newest candle is older than this many intervals is stale: the
 * provider is answering, but with history rather than the live market.
 */
const STALE_AFTER_INTERVALS = 3;

function straddlesWeekend(prevMs: number, nextMs: number): boolean {
  // Any gap containing a Saturday is treated as the weekly market close.
  for (let t = prevMs; t <= nextMs; t += 3_600_000) {
    if (new Date(t).getUTCDay() === 6) return true;
  }
  return false;
}

export function validateSeries(args: {
  timeframe: Timeframe;
  candles: readonly Candle[];
  required: number;
  now: Date;
}): SeriesReport {
  const { timeframe, candles, required, now } = args;
  const findings: SeriesFinding[] = [];
  const intervalMs = TIMEFRAME_MINUTES[timeframe] * 60_000;
  let missingIntervals = 0;

  if (candles.length === 0) {
    return {
      timeframe,
      count: 0,
      required,
      ok: false,
      findings: [{ problem: "empty", detail: "the provider returned no candles" }],
      lastCandleAt: null,
      missingIntervals: 0,
    };
  }

  if (candles.length < required) {
    findings.push({
      problem: "too_few",
      detail: `${candles.length} candles returned, ${required} required for a 200-period warm-up`,
    });
  }

  let previousMs: number | null = null;
  let lastCandleAt: string | null = null;

  for (const candle of candles) {
    const ms = new Date(candle.time).getTime();
    if (!Number.isFinite(ms)) {
      findings.push({
        problem: "unparseable_timestamp",
        detail: `candle timestamp "${String(candle.time)}" could not be parsed`,
      });
      continue;
    }
    lastCandleAt = new Date(ms).toISOString();

    const prices = [candle.open, candle.high, candle.low, candle.close];
    if (prices.some((p) => typeof p !== "number" || !Number.isFinite(p) || p <= 0)) {
      findings.push({
        problem: "non_finite_price",
        detail: `candle at ${lastCandleAt} carries a non-finite or non-positive price`,
      });
    } else if (
      candle.high < candle.low ||
      candle.open > candle.high ||
      candle.open < candle.low ||
      candle.close > candle.high ||
      candle.close < candle.low
    ) {
      findings.push({
        problem: "invalid_ohlc_geometry",
        detail: `candle at ${lastCandleAt} violates low <= open/close <= high`,
      });
    }

    if (previousMs !== null) {
      if (ms === previousMs) {
        findings.push({
          problem: "duplicate_timestamp",
          detail: `two candles share timestamp ${lastCandleAt}`,
        });
      } else if (ms < previousMs) {
        findings.push({
          problem: "not_ascending",
          detail: `candle at ${lastCandleAt} arrives before the previous candle`,
        });
      } else {
        const delta = ms - previousMs;
        if (delta > intervalMs * GAP_TOLERANCE_MULTIPLE && !straddlesWeekend(previousMs, ms)) {
          const skipped = Math.max(1, Math.round(delta / intervalMs) - 1);
          missingIntervals += skipped;
          findings.push({
            problem: "interval_gap",
            detail: `${skipped} missing ${timeframe} interval(s) before ${lastCandleAt}`,
          });
        }
      }
    }
    previousMs = ms;
  }

  if (previousMs !== null) {
    const ageMs = now.getTime() - previousMs;
    // The newest bar is still forming whenever less than one interval has elapsed
    // since it opened. Grading it would use a high/low that has not settled.
    if (ageMs >= 0 && ageMs < intervalMs) {
      findings.push({
        problem: "incomplete_current_candle",
        detail: `the newest ${timeframe} candle opened ${Math.round(ageMs / 60_000)} minutes ago and has not closed`,
      });
    }
    if (
      ageMs > intervalMs * STALE_AFTER_INTERVALS &&
      !straddlesWeekend(previousMs, now.getTime())
    ) {
      findings.push({
        problem: "stale_series",
        detail: `the newest ${timeframe} candle is ${Math.round(ageMs / 60_000)} minutes old`,
      });
    }
  }

  /**
   * `incomplete_current_candle` is INFORMATIONAL, not fatal: the live scanner has
   * always graded the series the provider returns, and failing readiness on it
   * would make readiness unreachable during any open market. Everything else is
   * fatal, because it means the series does not describe the market.
   */
  const fatal = findings.filter((f) => f.problem !== "incomplete_current_candle");

  return {
    timeframe,
    count: candles.length,
    required,
    ok: fatal.length === 0,
    findings,
    lastCandleAt,
    missingIntervals,
  };
}
