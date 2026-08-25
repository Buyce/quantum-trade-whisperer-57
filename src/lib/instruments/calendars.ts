/**
 * Versioned market calendars per asset class (Wave 2).
 *
 * `src/lib/market-hours.ts` is an FX calendar with FX assumptions baked in: a
 * Friday 21:00 / Sunday 21:00 UTC week and no daily break. That is true for spot
 * FX and close enough for gold, but it is wrong for an energy or index CFD, which
 * has a DAILY maintenance break and exchange holidays. Sampling across a break and
 * calling the resulting quote evidence is how a fabricated cost gets into research.
 *
 * DESIGN RULES
 *   1. A calendar is VERSIONED. Every sample and every candidate records the
 *      version it was judged against, so a later boundary change cannot silently
 *      re-interpret old evidence.
 *   2. A closed market is `closed`, never a provider failure. Missingness that is
 *      explained by a closure is expected absence, not a gap.
 *   3. A quote whose broker timestamp predates the current open window is `stale`
 *      and refused, so a price carried across a break can never be sampled.
 *   4. Wave 0/Wave 1 behaviour is preserved exactly: `fx_spot` and `metal_spot`
 *      reproduce the existing FX week, and nothing here is wired into the Wave 0
 *      scan path in this pass.
 */
import type { AssetClass } from "./registry";

export type MarketState = "open" | "closed_weekend" | "closed_holiday" | "closed_break";

export interface DailyBreak {
  /** Inclusive UTC start minute-of-day. */
  fromMinute: number;
  /** Exclusive UTC end minute-of-day. */
  toMinute: number;
  reason: string;
}

export interface MarketCalendar {
  key: string;
  version: number;
  assetClass: AssetClass;
  /** The venue's own timezone, recorded so DST handling is explicit. */
  sourceTimezone: string;
  /**
   * How the venue's session moves with DST.
   *
   * `utc_fixed` — boundaries are genuinely fixed in UTC (spot FX convention).
   * `venue_local` — boundaries follow the venue clock, so UTC boundaries shift.
   *   Instruments with `venue_local` may not be sampled until a DST-aware
   *   boundary source exists; this module reports that rather than approximating.
   */
  dstPolicy: "utc_fixed" | "venue_local";
  /** Weekly close (UTC day 0-6 + hour) and reopen. */
  weekClose: { day: number; hour: number };
  weekOpen: { day: number; hour: number };
  dailyBreaks: DailyBreak[];
  /** Recorded, dated holiday closures in `YYYY-MM-DD` form. */
  holidays: string[];
  note: string;
}

const FX_WEEK = { weekClose: { day: 5, hour: 21 }, weekOpen: { day: 0, hour: 21 } };

/**
 * Calendar definitions. These are OPERATOR-RECORDED configuration, not
 * measurements: the honest claim they make is "this is the window we will judge
 * an instrument against", and any instrument whose real venue disagrees fails
 * data validation rather than being quietly re-labelled.
 */
export const MARKET_CALENDARS: readonly MarketCalendar[] = [
  {
    key: "fx_spot",
    version: 1,
    assetClass: "fx",
    sourceTimezone: "UTC",
    dstPolicy: "utc_fixed",
    ...FX_WEEK,
    dailyBreaks: [],
    holidays: [],
    note: "Frozen Wave 0/Wave 1 FX week, identical to market-hours.ts.",
  },
  {
    key: "metal_spot",
    version: 1,
    assetClass: "metal",
    sourceTimezone: "UTC",
    dstPolicy: "utc_fixed",
    ...FX_WEEK,
    dailyBreaks: [],
    holidays: [],
    note: "Spot metals follow the FX week on this broker class. Frozen for XAUUSD.",
  },
  {
    key: "energy_cfd",
    version: 1,
    assetClass: "energy",
    sourceTimezone: "America/New_York",
    // Energy CFD hours follow the venue clock, so the UTC boundaries move twice a
    // year. Until a DST-aware boundary source is wired in, this calendar cannot
    // authorise sampling — see `calendarUsable`.
    dstPolicy: "venue_local",
    ...FX_WEEK,
    dailyBreaks: [{ fromMinute: 21 * 60, toMinute: 22 * 60, reason: "daily settlement break" }],
    holidays: [],
    note: "Placeholder boundaries pending broker session data; NOT usable for sampling.",
  },
  {
    key: "us_index_cfd",
    version: 1,
    assetClass: "index",
    sourceTimezone: "America/New_York",
    dstPolicy: "venue_local",
    ...FX_WEEK,
    dailyBreaks: [{ fromMinute: 21 * 60, toMinute: 22 * 60, reason: "daily settlement break" }],
    holidays: [],
    note: "Placeholder boundaries pending broker session data; NOT usable for sampling.",
  },
];

const BY_KEY = new Map(MARKET_CALENDARS.map((c) => [c.key, c]));

export function calendar(key: string): MarketCalendar | undefined {
  return BY_KEY.get(key);
}

/**
 * May this calendar authorise a measurement?
 *
 * A `venue_local` calendar carries approximate UTC boundaries, and an approximate
 * boundary would mark real closures as open. Those instruments are refused until
 * the broker's own session schedule has been fetched and recorded.
 */
export function calendarUsable(cal: MarketCalendar): { usable: boolean; reason: string | null } {
  if (cal.dstPolicy === "venue_local") {
    return {
      usable: false,
      reason: `calendar ${cal.key} v${cal.version} has venue-local boundaries that have not been sourced from the broker`,
    };
  }
  return { usable: true, reason: null };
}

function minuteOfDay(at: Date): number {
  return at.getUTCHours() * 60 + at.getUTCMinutes();
}

function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function inWeekend(cal: MarketCalendar, at: Date): boolean {
  const day = at.getUTCDay();
  const hour = at.getUTCHours();
  if (day === 6) return true;
  if (day === cal.weekClose.day && hour >= cal.weekClose.hour) return true;
  if (day === cal.weekOpen.day && hour < cal.weekOpen.hour) return true;
  return false;
}

export interface CalendarVerdict {
  state: MarketState;
  calendarKey: string;
  calendarVersion: number;
  /** Populated for every non-open state. */
  reason: string | null;
  /** Start of the window the instant belongs to, when open. */
  windowOpenedAt: Date | null;
}

/** Market state for one instant, judged against one versioned calendar. */
export function marketStateAt(cal: MarketCalendar, at: Date): CalendarVerdict {
  const base = { calendarKey: cal.key, calendarVersion: cal.version };

  if (inWeekend(cal, at)) {
    return { ...base, state: "closed_weekend", reason: "weekly closure", windowOpenedAt: null };
  }
  if (cal.holidays.includes(isoDate(at))) {
    return {
      ...base,
      state: "closed_holiday",
      reason: `recorded holiday ${isoDate(at)}`,
      windowOpenedAt: null,
    };
  }
  const minute = minuteOfDay(at);
  const br = cal.dailyBreaks.find((b) => minute >= b.fromMinute && minute < b.toMinute);
  if (br) {
    return { ...base, state: "closed_break", reason: br.reason, windowOpenedAt: null };
  }

  // Start of the current continuous window: the end of the most recent break that
  // finished earlier today, otherwise midnight UTC.
  const endedBreaks = cal.dailyBreaks.filter((b) => b.toMinute <= minute);
  const lastEnd = endedBreaks.length ? Math.max(...endedBreaks.map((b) => b.toMinute)) : 0;
  const opened = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 0, 0, 0, 0) + lastEnd * 60_000,
  );
  return { ...base, state: "open", reason: null, windowOpenedAt: opened };
}

/**
 * Is a broker quote timestamp usable as evidence at `at`?
 *
 * A quote from before the current window opened was produced on the other side of
 * a break or a closure. It is stale by construction, however recent it looks
 * relative to a naive freshness threshold.
 */
export function quoteWithinWindow(args: {
  cal: MarketCalendar;
  at: Date;
  sourceTime: Date | null;
}): { usable: boolean; state: MarketState; reason: string | null } {
  const verdict = marketStateAt(args.cal, args.at);
  if (verdict.state !== "open") {
    return { usable: false, state: verdict.state, reason: verdict.reason };
  }
  if (!args.sourceTime) {
    return { usable: false, state: verdict.state, reason: "broker quote has no source timestamp" };
  }
  if (verdict.windowOpenedAt && args.sourceTime < verdict.windowOpenedAt) {
    return {
      usable: false,
      state: verdict.state,
      reason: "quote predates the current trading window (carried across a closure)",
    };
  }
  return { usable: true, state: verdict.state, reason: null };
}
