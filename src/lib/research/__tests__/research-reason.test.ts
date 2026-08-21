/**
 * Prompt-7 item 2: the research ledger reason must be the exact terminal
 * evaluation stage, not the trader/job-facing prose.
 */
import { describe, expect, it } from "vitest";
import { evaluateSetup } from "@/lib/scanner/profile";
import { researchReason, v1ObservationRow } from "../observations.server";
import { CANDLE_SCENARIOS } from "@/test/fixtures/pre-p7/candle-sets";

const evaluations = CANDLE_SCENARIOS.map((s) =>
  evaluateSetup({ instrument: s.instrument, candles: s.candles, session: s.session }),
);

describe("V1 research reason semantics", () => {
  it("[INVARIANT] the reason always begins with the terminal stage enum value", () => {
    for (const ev of evaluations) {
      expect(researchReason(ev).startsWith(ev.stage)).toBe(true);
    }
  });

  it("[INVARIANT] a rejected evaluation never records the generic ABC prose", () => {
    const rejected = evaluations.filter((e) => e.stage !== "published");
    expect(rejected.length).toBeGreaterThan(0);
    for (const ev of rejected) {
      const row = v1ObservationRow({
        runId: "run-1",
        observationKey: "run-1|EURUSD",
        instrument: "EURUSD",
        decision: "no_trade",
        grade: null,
        direction: null,
        disposition: "none",
        // The job-facing text stays whatever production compatibility requires;
        // the ledger must not repeat it.
        reason: "No structure satisfied the ABC grading rules",
        latencyMs: null,
        evaluation: ev,
      });
      expect(row.reason).not.toContain("No structure satisfied");
      expect(row.reason).toBe(researchReason(ev));
      expect(row.reason!.startsWith(ev.stage)).toBe(true);
    }
  });

  it("[INVARIANT] the failing gate detail is carried when there is one", () => {
    const withDetail = evaluations.find((e) =>
      e.gates.some((g) => g.outcome === "fail" && g.detail),
    );
    if (!withDetail) return; // no gate in this fixture set produced a detail string
    const detail = [...withDetail.gates].reverse().find((g) => g.outcome === "fail")!.detail!;
    expect(researchReason(withDetail)).toBe(`${withDetail.stage}: ${detail}`);
  });

  it("[INVARIANT] the structured profile still carries stage, gates and features", () => {
    const row = v1ObservationRow({
      runId: "run-1",
      observationKey: "run-1|EURUSD",
      instrument: "EURUSD",
      decision: "no_trade",
      grade: null,
      direction: null,
      disposition: "none",
      reason: "job text",
      latencyMs: null,
      evaluation: evaluations[0]!,
    });
    const profile = row.profile as Record<string, unknown>;
    expect(profile["stage"]).toBe(evaluations[0]!.stage);
    expect(Array.isArray(profile["gates"])).toBe(true);
    expect(profile["features"]).toBeTruthy();
  });

  it("[INVARIANT] with no evaluation available the caller's reason is preserved rather than invented", () => {
    const row = v1ObservationRow({
      runId: null,
      observationKey: null,
      instrument: "EURUSD",
      decision: "error",
      grade: null,
      direction: null,
      disposition: "none",
      reason: "fetch failed",
      latencyMs: null,
      evaluation: null,
    });
    expect(row.reason).toBe("fetch failed");
    expect(row.profile).toBeNull();
  });
});
