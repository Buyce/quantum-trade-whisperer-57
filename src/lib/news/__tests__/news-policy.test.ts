/**
 * News policy invariants.
 *
 * Two properties matter more than any window arithmetic:
 *   1. unknown coverage suppresses (it is never read as clearance);
 *   2. a verdict in dark mode is recorded but never enforced.
 */
import { describe, expect, it } from "vitest";

import type { CoverageState } from "../coverage";
import { evaluateNewsPolicy, NEWS_POLICY_VERSION, type PolicyEvent } from "../policy";

const NOW = Date.parse("2026-09-10T12:00:00Z");

function coverage(state: CoverageState, symbol = "EURUSD"): Map<string, CoverageState> {
  const map = new Map<string, CoverageState>();
  for (const currency of symbol === "EURUSD" ? ["EUR", "USD"] : ["USD"]) {
    for (const family of ["central_bank", "inflation", "employment"]) {
      map.set(`${currency}|${family}`, state);
    }
  }
  return map;
}

function exactEvent(overrides: Partial<PolicyEvent> = {}): PolicyEvent {
  return {
    canonicalEventId: "usd:us-cpi:2026-09-10",
    family: "inflation",
    currencies: ["USD"],
    importance: "high",
    scheduledAt: "2026-09-10T12:30:00Z",
    scheduledDate: "2026-09-10",
    timestampPrecision: "exact",
    status: "scheduled",
    ...overrides,
  };
}

describe("news policy", () => {
  it("[INVARIANT] unproven coverage suppresses new entries", () => {
    const verdict = evaluateNewsPolicy({
      symbol: "EURUSD",
      nowMs: NOW,
      mode: "enforcing",
      events: [],
      coverage: new Map(),
    });
    expect(verdict.wouldSuppressNewEntries).toBe(true);
    expect(verdict.reason).toBe("coverage_incomplete");
    expect(verdict.coverageState).toBe("unproven");
  });

  it("[INVARIANT] dark mode records a suppression verdict without enforcing it", () => {
    const verdict = evaluateNewsPolicy({
      symbol: "EURUSD",
      nowMs: NOW,
      mode: "dark",
      events: [],
      coverage: new Map(),
    });
    expect(verdict.wouldSuppressNewEntries).toBe(true);
    expect(verdict.enforced).toBe(false);
    expect(verdict.policyVersion).toBe(NEWS_POLICY_VERSION);
  });

  it("[UNIT] an exact high-impact event inside its window suppresses", () => {
    const verdict = evaluateNewsPolicy({
      symbol: "EURUSD",
      nowMs: NOW,
      mode: "enforcing",
      events: [exactEvent()],
      coverage: coverage("healthy"),
    });
    expect(verdict.reason).toBe("event_window");
    expect(verdict.enforced).toBe(true);
    expect(verdict.blockingEventIds).toEqual(["usd:us-cpi:2026-09-10"]);
  });

  it("[UNIT] an exact event outside its window with healthy coverage clears", () => {
    const verdict = evaluateNewsPolicy({
      symbol: "EURUSD",
      nowMs: NOW,
      mode: "enforcing",
      events: [exactEvent({ scheduledAt: "2026-09-10T18:00:00Z" })],
      coverage: coverage("healthy"),
    });
    expect(verdict.wouldSuppressNewEntries).toBe(false);
    expect(verdict.reason).toBe("clear");
  });

  it("[INVARIANT] a date-only event today can never authorise an intraday window, and suppresses instead", () => {
    const verdict = evaluateNewsPolicy({
      symbol: "EURUSD",
      nowMs: NOW,
      mode: "enforcing",
      events: [exactEvent({ timestampPrecision: "date_only", scheduledAt: null })],
      coverage: coverage("healthy"),
    });
    expect(verdict.reason).toBe("release_time_unknown");
    expect(verdict.wouldSuppressNewEntries).toBe(true);
  });

  it("[INVARIANT] timestamp_incomplete coverage suppresses even with no events", () => {
    const verdict = evaluateNewsPolicy({
      symbol: "EURUSD",
      nowMs: NOW,
      mode: "enforcing",
      events: [],
      coverage: coverage("timestamp_incomplete"),
    });
    expect(verdict.reason).toBe("release_time_unknown");
  });

  it("[UNIT] a cancelled event does not suppress", () => {
    const verdict = evaluateNewsPolicy({
      symbol: "EURUSD",
      nowMs: NOW,
      mode: "enforcing",
      events: [exactEvent({ status: "cancelled" })],
      coverage: coverage("healthy"),
    });
    expect(verdict.wouldSuppressNewEntries).toBe(false);
  });

  it("[UNIT] a low-importance event has no suppression window", () => {
    const verdict = evaluateNewsPolicy({
      symbol: "EURUSD",
      nowMs: NOW,
      mode: "enforcing",
      events: [exactEvent({ importance: "low" })],
      coverage: coverage("healthy"),
    });
    expect(verdict.wouldSuppressNewEntries).toBe(false);
  });

  it("[INVARIANT] an instrument with no news profile is never cleared", () => {
    const verdict = evaluateNewsPolicy({
      symbol: "NOT_A_SYMBOL",
      nowMs: NOW,
      mode: "dark",
      events: [],
      coverage: new Map(),
    });
    expect(verdict.reason).toBe("no_news_profile");
    expect(verdict.wouldSuppressNewEntries).toBe(true);
  });
});
