/**
 * Evidence-based ordering of the daily cap sequence.
 *
 * The contract: ranking may change WHICH setups spend the cap, never HOW MANY,
 * and never whether a setup is eligible at all. A cohort with no measured replay
 * evidence keeps its chronological place and can never outrank a measured one.
 */
import { describe, expect, it } from "vitest";

import {
  buildCapFrame,
  capSequence,
  type CapRanker,
  type EligibilitySettings,
  type EligibilitySignal,
} from "../eligibility";

const DAY = "2026-09-05";
const NOW = Date.parse(`${DAY}T12:00:00Z`);

const settings: EligibilitySettings = {
  instruments: [],
  sessions: [],
  min_grade: "C",
  alert_min_grade: "C",
  daily_setup_cap: 2,
};

const signal = (id: string, hour: number, instrument: string): EligibilitySignal => ({
  id,
  detected_at: `${DAY}T${String(hour).padStart(2, "0")}:00:00Z`,
  instrument,
  grade: "B",
  trading_session: "london",
  direction: "long",
});

const frame = [signal("a", 1, "EURUSD"), signal("b", 2, "XAUUSD"), signal("c", 3, "GBPAUD")];

describe("capSequence with an evidence ranker", () => {
  it("stays chronological with no ranker", () => {
    expect(capSequence(frame, settings, "alert", NOW).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("puts the measured cohort first, best score first", () => {
    const ranker: CapRanker = (s) =>
      s.instrument === "GBPAUD" ? 0.4 : s.instrument === "XAUUSD" ? 0.9 : null;
    expect(capSequence(frame, settings, "alert", NOW, ranker).map((s) => s.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("keeps unmeasured setups in their original order behind measured ones", () => {
    const ranker: CapRanker = (s) => (s.instrument === "GBPAUD" ? 0.1 : null);
    expect(capSequence(frame, settings, "alert", NOW, ranker).map((s) => s.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("changes which setups are capped out but never how many", () => {
    const none = buildCapFrame(frame, settings, "alert", NOW);
    const ranked = buildCapFrame(frame, settings, "alert", NOW, (s) =>
      s.instrument === "GBPAUD" ? 0.5 : null,
    );
    expect(none.size).toBe(ranked.size);
    expect([...none]).toEqual(["c"]);
    expect([...ranked]).toEqual(["b"]);
  });

  it("is inert when every cohort is unmeasured", () => {
    const ranked = capSequence(frame, settings, "alert", NOW, () => null);
    expect(ranked.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});
