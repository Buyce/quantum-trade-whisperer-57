/**
 * The optional evidence ranker for the daily cap.
 *
 * The default is unchanged and MUST stay unchanged: without a ranker the cap
 * sequence is purely chronological, which is the ordering the feed, the cap badge
 * and the alert fan-out already publish to users.
 */
import { describe, expect, it } from "vitest";

import {
  buildCapFrame,
  capSequence,
  type EligibilitySettings,
  type EligibilitySignal,
} from "../eligibility";

const settings: EligibilitySettings = {
  instruments: ["EURUSD", "XAUUSD", "GBPJPY"],
  sessions: [],
  min_grade: "B",
  alert_min_grade: "B",
  daily_setup_cap: 2,
};

const now = Date.UTC(2026, 0, 15, 20, 0, 0);

function signal(id: string, instrument: string, hour: number): EligibilitySignal {
  return {
    id,
    detected_at: new Date(Date.UTC(2026, 0, 15, hour, 0, 0)).toISOString(),
    instrument,
    grade: "B",
    trading_session: null,
  };
}

const frame = [
  signal("a", "EURUSD", 8),
  signal("b", "XAUUSD", 9),
  signal("c", "GBPJPY", 10),
];

describe("capSequence", () => {
  it("[INVARIANT] stays chronological when no ranker is supplied", () => {
    expect(capSequence(frame, settings, "alert", now).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("[UNIT] puts higher-scoring measured cohorts first", () => {
    const scores: Record<string, number | null> = { a: 0.1, b: 0.9, c: 0.5 };
    const ordered = capSequence(frame, settings, "alert", now, (s) => scores[s.id] ?? null);
    expect(ordered.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("[INVARIANT] never lets an unmeasured setup outrank a measured one", () => {
    const scores: Record<string, number | null> = { a: null, b: null, c: 0.2 };
    const ordered = capSequence(frame, settings, "alert", now, (s) => scores[s.id] ?? null);
    expect(ordered.map((s) => s.id)).toEqual(["c", "a", "b"]);
  });

  it("[INVARIANT] keeps chronological order among equal and unmeasured setups", () => {
    const ordered = capSequence(frame, settings, "alert", now, () => null);
    expect(ordered.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("[UNIT] spends the cap on the ranked setups", () => {
    const scores: Record<string, number | null> = { a: 0.1, b: 0.9, c: 0.5 };
    const cappedOut = buildCapFrame(frame, settings, "alert", now, (s) => scores[s.id] ?? null);
    expect([...cappedOut]).toEqual(["a"]);
    expect([...buildCapFrame(frame, settings, "alert", now)]).toEqual(["c"]);
  });
});
