/**
 * News suppression policy — pure, versioned, and dark by default.
 *
 * Two separate questions:
 *   1. WOULD this instrument be suppressed right now?  (always computed)
 *   2. IS that suppression enforced?                   (only in "enforcing" mode)
 *
 * Wave 0 runs in comparison mode: the verdict is recorded, never applied, so an
 * incomplete calendar can never change behaviour that is already live. An
 * instrument only moves to enforcing after its coverage has been proven, and even
 * then unknown coverage suppresses rather than clears.
 */
import { newsFamiliesOf } from "@/lib/instruments/news-risk";

import { coverageClears, worstCoverage, type CoverageState } from "./coverage";
import { requiredCoverageFor } from "./identity";
import type { EventImportance, NewsFamily, TimestampPrecision } from "./types";

export const NEWS_POLICY_VERSION = "news-policy-1";

export type NewsPolicyMode = "dark" | "enforcing";

/**
 * Suppression windows in minutes, by importance.
 *
 * These are policy, not observation: they are applied only to events whose release
 * time is known exactly.
 */
export const SUPPRESSION_WINDOWS: Record<
  EventImportance,
  { beforeMinutes: number; afterMinutes: number }
> = {
  high: { beforeMinutes: 60, afterMinutes: 30 },
  medium: { beforeMinutes: 30, afterMinutes: 15 },
  low: { beforeMinutes: 0, afterMinutes: 0 },
  unknown: { beforeMinutes: 60, afterMinutes: 30 },
};

export interface PolicyEvent {
  canonicalEventId: string;
  family: NewsFamily;
  currencies: string[];
  importance: EventImportance;
  scheduledAt: string | null;
  scheduledDate: string | null;
  timestampPrecision: TimestampPrecision;
  status: string;
  affectedInstruments?: string[];
}

export type NewsPolicyReason =
  "clear" | "no_news_profile" | "coverage_incomplete" | "event_window" | "release_time_unknown";

export interface NewsPolicyVerdict {
  symbol: string;
  mode: NewsPolicyMode;
  policyVersion: string;
  /** The verdict on the data. Independent of whether it is enforced. */
  wouldSuppressNewEntries: boolean;
  /** True only when the verdict is actually applied to delivery. */
  enforced: boolean;
  reason: NewsPolicyReason;
  detail: string;
  coverageState: CoverageState;
  blockingEventIds: string[];
  requiredScopes: { currency: string; family: NewsFamily }[];
  evaluatedAt: string;
}

export interface NewsPolicyInput {
  symbol: string;
  nowMs: number;
  mode: NewsPolicyMode;
  events: PolicyEvent[];
  /** Coverage state per `${CURRENCY}|${family}`; missing means unproven. */
  coverage: Map<string, CoverageState>;
  /**
   * Owner-configured suppression window in minutes, applied to `high` and
   * `unknown` importance only. Absent means the default policy window. A window
   * is never widened beyond what the owner asked for and never silently changed
   * for `medium`/`low`, whose defaults are policy, not preference.
   */
  windowOverride?: { beforeMinutes: number; afterMinutes: number } | null;
}

function windowFor(
  importance: EventImportance,
  override?: { beforeMinutes: number; afterMinutes: number } | null,
) {
  if (override && (importance === "high" || importance === "unknown")) return override;
  return SUPPRESSION_WINDOWS[importance] ?? SUPPRESSION_WINDOWS.unknown;
}


function eventTouches(event: PolicyEvent, symbol: string, currencies: string[]): boolean {
  if (event.affectedInstruments && event.affectedInstruments.length > 0) {
    return event.affectedInstruments.includes(symbol);
  }
  const wanted = new Set(currencies.map((c) => c.toUpperCase()));
  return event.currencies.some((c) => wanted.has(c.toUpperCase()));
}

export function evaluateNewsPolicy(input: NewsPolicyInput): NewsPolicyVerdict {
  const { currencies, families } = requiredCoverageFor(input.symbol);
  const requiredScopes = currencies.flatMap((currency) =>
    families.map((family) => ({ currency, family })),
  );
  const evaluatedAt = new Date(input.nowMs).toISOString();
  const base = {
    symbol: input.symbol,
    mode: input.mode,
    policyVersion: NEWS_POLICY_VERSION,
    enforced: input.mode === "enforcing",
    requiredScopes,
    evaluatedAt,
  };

  if (newsFamiliesOf(input.symbol).length === 0) {
    return {
      ...base,
      wouldSuppressNewEntries: true,
      reason: "no_news_profile",
      detail: `no news-risk profile is recorded for ${input.symbol}`,
      coverageState: "unproven",
      blockingEventIds: [],
    };
  }

  const states = requiredScopes.map(
    (scope) => input.coverage.get(`${scope.currency.toUpperCase()}|${scope.family}`) ?? "unproven",
  );
  const coverageState = worstCoverage(states);

  const relevant = input.events.filter(
    (event) =>
      families.includes(event.family) &&
      eventTouches(event, input.symbol, currencies) &&
      event.status !== "cancelled",
  );

  // An event known only to the calendar day cannot authorise an intraday window,
  // but it also cannot be treated as absent: it downgrades the day.
  const dateOnlyToday = relevant.filter(
    (event) =>
      event.timestampPrecision !== "exact" &&
      event.scheduledDate === evaluatedAt.slice(0, 10) &&
      windowFor(event.importance, input.windowOverride).beforeMinutes > 0,
  );

  const inWindow = relevant.filter((event) => {
    if (event.timestampPrecision !== "exact" || !event.scheduledAt) return false;
    const at = Date.parse(event.scheduledAt);
    if (Number.isNaN(at)) return false;
    const { beforeMinutes, afterMinutes } = windowFor(event.importance, input.windowOverride);

    if (beforeMinutes === 0 && afterMinutes === 0) return false;
    return input.nowMs >= at - beforeMinutes * 60_000 && input.nowMs <= at + afterMinutes * 60_000;
  });

  if (inWindow.length > 0) {
    return {
      ...base,
      wouldSuppressNewEntries: true,
      reason: "event_window",
      detail: `${inWindow.length} high-impact event(s) inside their suppression window`,
      coverageState,
      blockingEventIds: inWindow.map((e) => e.canonicalEventId),
    };
  }

  if (!coverageClears(coverageState)) {
    return {
      ...base,
      wouldSuppressNewEntries: true,
      reason:
        coverageState === "timestamp_incomplete" ? "release_time_unknown" : "coverage_incomplete",
      detail: `news coverage for ${input.symbol} is "${coverageState}"; unknown coverage is not clearance`,
      coverageState,
      blockingEventIds: dateOnlyToday.map((e) => e.canonicalEventId),
    };
  }

  if (dateOnlyToday.length > 0) {
    return {
      ...base,
      wouldSuppressNewEntries: true,
      reason: "release_time_unknown",
      detail: `${dateOnlyToday.length} event(s) today publish a date without an exact release time`,
      coverageState,
      blockingEventIds: dateOnlyToday.map((e) => e.canonicalEventId),
    };
  }

  return {
    ...base,
    wouldSuppressNewEntries: false,
    reason: "clear",
    detail: "coverage is complete and no event is inside a suppression window",
    coverageState,
    blockingEventIds: [],
  };
}
