import { describe, expect, it } from "vitest";

import {
  buildCohortEvidence,
  cohortKey,
  cohortRankScore,
  cohortRefused,
  declaredCohortKeys,
  UNKNOWN_SESSION,
  type CohortObservation,
} from "../cohort";
import { DECIDABLE_MIN_SAMPLES_PER_ARM } from "../readiness";

function rows(args: {
  instrument: string;
  direction: string;
  session: string | null;
  /** One value per observation, spread across distinct UTC days. */
  values: number[];
}): CohortObservation[] {
  return args.values.map((r, i) => {
    const day = String(1 + (i % 28)).padStart(2, "0");
    return {
      id: `${args.instrument}-${args.direction}-${i}`,
      detectedAt: `2026-01-${day}T10:00:00.000Z`,
      r,
      instrument: args.instrument,
      direction: args.direction,
      session: args.session,
    };
  });
}

describe("cohortKey", () => {
  it("buckets a missing session rather than dropping it", () => {
    expect(cohortKey("EURUSD", "long", null)).toBe(`EURUSD|long|${UNKNOWN_SESSION}`);
  });
});

describe("declaredCohortKeys", () => {
  it("is bounded and predeclared, not grown from the data", () => {
    const keys = declaredCohortKeys(["EURUSD", "XAUUSD"]);
    // 2 instruments x 2 directions x (5 sessions + unknown)
    expect(keys.length).toBe(24);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("EURUSD|short|london");
  });
});

describe("buildCohortEvidence", () => {
  it("marks a thin cohort insufficient and never refuses it", () => {
    const evidence = buildCohortEvidence(
      rows({ instrument: "EURUSD", direction: "long", session: "london", values: [-1, -1, -1] }),
    );
    const hit = evidence.get("EURUSD|long|london")!;
    expect(hit.verdict).toBe("insufficient");
    expect(hit.detail).toContain(String(DECIDABLE_MIN_SAMPLES_PER_ARM));
    expect(cohortRefused(evidence, "EURUSD", "long", "london")).toBeNull();
  });

  it("refuses only a cohort whose whole interval is below zero", () => {
    const evidence = buildCohortEvidence(
      rows({
        instrument: "GBPAUD",
        direction: "short",
        session: "tokyo",
        values: Array.from({ length: 40 }, () => -1),
      }),
    );
    const hit = evidence.get("GBPAUD|short|tokyo")!;
    expect(hit.verdict).toBe("negative");
    expect(hit.ciHi).not.toBeNull();
    expect(hit.ciHi!).toBeLessThan(0);
    expect(cohortRefused(evidence, "GBPAUD", "short", "tokyo")).not.toBeNull();
  });

  it("leaves an inconclusive cohort alone", () => {
    const evidence = buildCohortEvidence(
      rows({
        instrument: "EURUSD",
        direction: "long",
        session: "new_york",
        values: Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 1 : -1)),
      }),
    );
    const hit = evidence.get("EURUSD|long|new_york")!;
    expect(hit.verdict).toBe("inconclusive");
    expect(cohortRefused(evidence, "EURUSD", "long", "new_york")).toBeNull();
    expect(cohortRankScore(evidence, "EURUSD", "long", "new_york")).toBeNull();
  });

  it("scores a proven-positive cohort for ranking", () => {
    const evidence = buildCohortEvidence(
      rows({
        instrument: "XAUUSD",
        direction: "long",
        session: "london",
        values: Array.from({ length: 40 }, () => 1),
      }),
    );
    expect(evidence.get("XAUUSD|long|london")!.verdict).toBe("positive");
    expect(cohortRankScore(evidence, "XAUUSD", "long", "london")).toBeCloseTo(1, 6);
  });

  it("returns no score for a cohort it has never measured", () => {
    const evidence = buildCohortEvidence([]);
    expect(cohortRankScore(evidence, "EURUSD", "long", "london")).toBeNull();
    expect(cohortRefused(evidence, "EURUSD", "long", "london")).toBeNull();
  });

  it("ignores rows with a non-finite R rather than defaulting them", () => {
    const evidence = buildCohortEvidence([
      ...rows({ instrument: "EURUSD", direction: "long", session: "london", values: [1, -1] }),
      {
        id: "bad",
        detectedAt: "2026-01-05T10:00:00.000Z",
        r: Number.NaN,
        instrument: "EURUSD",
        direction: "long",
        session: "london",
      },
    ]);
    expect(evidence.get("EURUSD|long|london")!.n).toBe(2);
  });
});
