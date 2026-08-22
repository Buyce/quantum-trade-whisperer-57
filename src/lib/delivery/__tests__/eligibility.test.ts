/**
 * Prompt 10 — canonical eligibility. These tests are the contract for the ONE
 * shared implementation used by the alert fan-out, the feed, the realtime toast
 * and MCP. A second implementation of any rule here is a defect by definition.
 */
import { describe, expect, it } from "vitest";
import {
  baseEligibility,
  buildCapFrame,
  capSequence,
  countEligibleGradedToday,
  evaluateEligibility,
  type EligibilitySettings,
  type EligibilitySignal,
} from "../eligibility";
import type { Grade } from "@/lib/db-types";

const DAY = "2026-08-22T";
const NOW = new Date(`${DAY}12:00:00.000Z`).getTime();

function sig(
  id: string,
  grade: Grade,
  instrument: string,
  hhmm: string,
  session: string | null = "london",
): EligibilitySignal {
  return { id, grade, instrument, detected_at: `${DAY}${hhmm}:00.000Z`, trading_session: session };
}

const goldLondonMinA: EligibilitySettings = {
  instruments: ["XAUUSD"],
  sessions: ["london"],
  min_grade: "A",
  alert_min_grade: "A",
  daily_setup_cap: 2,
};

describe("baseEligibility", () => {
  it("[UNIT] filters by instrument, grade and session", () => {
    expect(baseEligibility(sig("1", "A", "EURUSD", "08:00"), goldLondonMinA, "feed", NOW)).toEqual({
      eligible: false,
      reason: "instrument_filtered",
    });
    expect(baseEligibility(sig("2", "B", "XAUUSD", "08:00"), goldLondonMinA, "feed", NOW)).toEqual({
      eligible: false,
      reason: "below_min_grade",
    });
    expect(
      baseEligibility(sig("3", "A", "XAUUSD", "08:00", "tokyo"), goldLondonMinA, "feed", NOW),
    ).toEqual({ eligible: false, reason: "session_filtered" });
    expect(
      baseEligibility(sig("4", "A", "XAUUSD", "08:00"), goldLondonMinA, "feed", NOW).eligible,
    ).toBe(true);
  });

  it("[INVARIANT] never suppresses a signal whose market_context is not readable yet", () => {
    const unknown = sig("5", "A", "XAUUSD", "08:00", null);
    expect(baseEligibility(unknown, goldLondonMinA, "feed", NOW).eligible).toBe(true);
  });

  it("[UNIT] uses min_grade for the feed and alert_min_grade for alerts", () => {
    const settings: EligibilitySettings = {
      instruments: [],
      sessions: [],
      min_grade: "C",
      alert_min_grade: "A",
      daily_setup_cap: 0,
    };
    const b = sig("6", "B", "EURUSD", "08:00");
    expect(baseEligibility(b, settings, "feed", NOW).eligible).toBe(true);
    expect(baseEligibility(b, settings, "alert", NOW)).toEqual({
      eligible: false,
      reason: "below_alert_grade",
    });
  });

  it("[UNIT] applies the grade's retention window", () => {
    const aPlus = sig("7", "A+", "XAUUSD", "00:00");
    const at47h = new Date(`2026-08-24T00:00:00.000Z`).getTime() - 60_000;
    const at48h = new Date(`2026-08-24T00:00:00.000Z`).getTime() + 60_000;
    expect(baseEligibility(aPlus, goldLondonMinA, "feed", at47h).eligible).toBe(true);
    expect(baseEligibility(aPlus, goldLondonMinA, "feed", at48h)).toEqual({
      eligible: false,
      reason: "expired_retention",
    });
  });

  it("[INVARIANT] keeps resolved setups base-eligible (resolution alone never hides a row)", () => {
    // The eligibility input carries no status at all — resolution is a display
    // concern ("Active only"), never an eligibility rule.
    const s = sig("8", "A", "XAUUSD", "08:00");
    expect(Object.keys(s)).not.toContain("status");
    expect(baseEligibility(s, goldLondonMinA, "feed", NOW).eligible).toBe(true);
  });
});

describe("daily cap", () => {
  it("[UNIT] is consumed only by signals the user is eligible for", () => {
    const frame = [
      sig("e1", "B", "EURUSD", "06:00"),
      sig("e2", "B", "EURUSD", "07:00"),
      sig("g1", "A+", "XAUUSD", "08:00"),
    ];
    const capped = buildCapFrame(frame, goldLondonMinA, "feed", NOW);
    expect(capped.size).toBe(0);
    expect(countEligibleGradedToday(frame, goldLondonMinA, "feed", NOW)).toBe(1);
    expect(
      evaluateEligibility({
        signal: frame[2]!,
        settings: goldLondonMinA,
        channel: "feed",
        now: NOW,
        cappedOutIds: capped,
      }),
    ).toEqual({ eligible: true, reason: "eligible" });
  });

  it("[UNIT] suppresses the signals beyond the cap in (detected_at, id) order", () => {
    const frame = [
      sig("g1", "A", "XAUUSD", "06:00"),
      sig("g2", "A", "XAUUSD", "07:00"),
      sig("g3", "A", "XAUUSD", "08:00"),
    ];
    const capped = buildCapFrame(frame, goldLondonMinA, "feed", NOW);
    expect([...capped]).toEqual(["g3"]);
    expect(
      evaluateEligibility({
        signal: frame[2]!,
        settings: goldLondonMinA,
        channel: "feed",
        now: NOW,
        cappedOutIds: capped,
      }),
    ).toEqual({ eligible: false, reason: "daily_cap_reached" });
  });

  it("[INVARIANT] is deterministic regardless of input order, and ties break on id", () => {
    const rows = [
      sig("b", "A", "XAUUSD", "06:00"),
      sig("a", "A", "XAUUSD", "06:00"),
      sig("c", "A", "XAUUSD", "09:00"),
    ];
    const one = capSequence(rows, goldLondonMinA, "feed", NOW).map((s) => s.id);
    const two = capSequence([...rows].reverse(), goldLondonMinA, "feed", NOW).map((s) => s.id);
    expect(one).toEqual(["a", "b", "c"]);
    expect(two).toEqual(one);
  });

  it("[INVARIANT] never lets C-Grade consume cap", () => {
    const frame = [
      sig("c1", "C", "XAUUSD", "05:00"),
      sig("c2", "C", "XAUUSD", "05:30"),
      sig("g1", "A", "XAUUSD", "06:00"),
      sig("g2", "A", "XAUUSD", "07:00"),
    ];
    expect([...buildCapFrame(frame, goldLondonMinA, "feed", NOW)]).toEqual([]);
  });

  it("[UNIT] treats cap 0 as unlimited", () => {
    const settings = { ...goldLondonMinA, daily_setup_cap: 0 };
    const frame = Array.from({ length: 20 }, (_, i) =>
      sig(`g${i}`, "A", "XAUUSD", `${String(i).padStart(2, "0")}:00`),
    );
    expect(buildCapFrame(frame, settings, "feed", NOW).size).toBe(0);
  });

  it("[UNIT] keeps feed and alert cap sequences separate when thresholds differ", () => {
    const settings: EligibilitySettings = {
      instruments: [],
      sessions: [],
      min_grade: "B",
      alert_min_grade: "A",
      daily_setup_cap: 1,
    };
    const frame = [sig("b1", "B", "EURUSD", "06:00"), sig("a1", "A", "EURUSD", "07:00")];
    // Feed: B is first in sequence, so the A is capped out.
    expect([...buildCapFrame(frame, settings, "feed", NOW)]).toEqual(["a1"]);
    // Alert: the B is not alert-eligible, so the A is the first and stays in.
    expect([...buildCapFrame(frame, settings, "alert", NOW)]).toEqual([]);
  });

  it("[UNIT] ignores signals from a previous UTC day", () => {
    const frame = [
      { ...sig("y1", "A", "XAUUSD", "06:00"), detected_at: "2026-08-21T23:00:00.000Z" },
      sig("g1", "A", "XAUUSD", "06:00"),
      sig("g2", "A", "XAUUSD", "07:00"),
    ];
    expect([...buildCapFrame(frame, goldLondonMinA, "feed", NOW)]).toEqual([]);
  });
});
