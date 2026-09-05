import { describe, expect, it } from "vitest";
import {
  COUNTERFACTUAL_VERSION,
  evaluateBreakevenStop,
  evaluateTighterStop,
  isSupported,
  type CounterfactualInput,
  type CounterfactualReport,
} from "../counterfactual";

const row = (over: Partial<CounterfactualInput> & { id: string }): CounterfactualInput => ({
  detectedAt: "2026-08-27T00:00:00.000Z",
  outcome: "win",
  grossR: 1,
  maeR: 0.2,
  mfeR: 1.1,
  ...over,
});

const report = (rows: CounterfactualInput[], factor = 0.6): CounterfactualReport => {
  const r = evaluateTighterStop(rows, factor);
  if ("decidable" in r) throw new Error("expected a decidable report");
  return r;
};

describe("evaluateTighterStop — admissible factors", () => {
  it.each([0, 1, 1.5, -0.5, Number.NaN, Infinity])(
    "[INVARIANT] refuses factor %s as not decidable",
    (f) => {
      const r = evaluateTighterStop([row({ id: "a" })], f);
      expect(r).toMatchObject({ decidable: false, version: COUNTERFACTUAL_VERSION });
      if ("decidable" in r) expect(r.missing).toContain("strictly between 0 and 1");
    },
  );
});

describe("evaluateTighterStop — per-row adjudication", () => {
  it("[UNIT] a winner whose adverse path stayed inside the tighter stop is proven and pays more", () => {
    const r = report([row({ id: "a", outcome: "win", grossR: 1, maeR: 0.2 })], 0.6);
    expect(r.rows[0]).toMatchObject({ verdict: "deterministic", baseR: 1 });
    // 1R against a 0.6x risk denominator.
    expect(r.rows[0]!.worstR).toBeCloseTo(1 / 0.6, 10);
    expect(r.rows[0]!.bestR).toBeCloseTo(1 / 0.6, 10);
  });

  it("[INVARIANT] a winner that reached the tighter stop is AMBIGUOUS, never resolved favourably", () => {
    const r = report([row({ id: "a", outcome: "win", grossR: 1, maeR: 0.75 })], 0.6);
    expect(r.rows[0]!.verdict).toBe("ambiguous");
    expect(r.rows[0]!.worstR).toBe(-1);
    expect(r.rows[0]!.bestR).toBeCloseTo(1 / 0.6, 10);
    expect(r.rows[0]!.reason).toContain("cannot order");
  });

  it("[UNIT] a loser is deterministic: a tighter stop was reached too", () => {
    const r = report([row({ id: "a", outcome: "loss", grossR: -1, maeR: 1.4 })], 0.6);
    expect(r.rows[0]).toMatchObject({ verdict: "deterministic", worstR: -1, bestR: -1 });
  });

  it("[INVARIANT] a never-filled setup is untouched by stop distance", () => {
    const r = report([row({ id: "a", outcome: "never_filled", grossR: 0, maeR: 0 })]);
    expect(r.rows[0]).toMatchObject({ verdict: "deterministic", baseR: 0, worstR: 0, bestR: 0 });
  });

  it("[INVARIANT] excludes outcomes it cannot adjudicate rather than guessing", () => {
    const r = report([
      row({ id: "a", outcome: "gap_beyond_stop", grossR: null }),
      row({ id: "b", outcome: "invalid_plan", grossR: null }),
      row({ id: "c", outcome: null, grossR: null }),
    ]);
    expect(r.excluded).toBe(3);
    expect(r.considered).toBe(0);
    for (const got of r.rows) expect(got.worstR).toBeNull();
  });

  it("[INVARIANT] excludes a row with a missing adverse excursion instead of assuming zero", () => {
    const r = report([row({ id: "a", outcome: "win", grossR: 1, maeR: null })]);
    expect(r.rows[0]).toMatchObject({ verdict: "excluded", worstR: null });
    expect(r.rows[0]!.reason).toContain("max adverse excursion");
  });

  it("[UNIT] scales an expiry by the same denominator when it stayed inside the stop", () => {
    const r = report([row({ id: "a", outcome: "expired", grossR: 0.3, maeR: 0.1 })], 0.5);
    expect(r.rows[0]!.worstR).toBeCloseTo(0.6, 10);
  });
});

describe("evaluateTighterStop — arms", () => {
  const rows = [
    ...Array.from({ length: 12 }, (_, i) =>
      row({
        id: `w${i}`,
        detectedAt: `2026-08-${String(10 + i).padStart(2, "0")}T00:00:00.000Z`,
        outcome: "win",
        grossR: 1,
        maeR: 0.2,
      }),
    ),
    ...Array.from({ length: 12 }, (_, i) =>
      row({
        id: `l${i}`,
        detectedAt: `2026-08-${String(10 + i).padStart(2, "0")}T01:00:00.000Z`,
        outcome: "loss",
        grossR: -1,
        maeR: 1.2,
      }),
    ),
  ];

  it("[INVARIANT] compares the live rule and the proposal over exactly the same rows", () => {
    const r = report(rows, 0.6);
    expect(r.baseline.n).toBe(r.conservative.n);
    expect(r.baseline.n).toBe(24);
    // Live rule: 12 x +1R and 12 x -1R is a coin flip.
    expect(r.baseline.meanR).toBeCloseTo(0, 10);
    // Tighter stop keeps every winner here and pays 1/0.6 each.
    expect(r.conservative.meanR).toBeCloseTo((12 * (1 / 0.6) - 12) / 24, 10);
  });

  it("[INVARIANT] the conservative arm is never better than the optimistic arm", () => {
    const r = report([...rows, row({ id: "amb", outcome: "win", grossR: 1, maeR: 0.9 })], 0.6);
    expect(r.ambiguous).toBe(1);
    expect(r.conservative.meanR!).toBeLessThan(r.optimistic.meanR!);
  });

  it("[INVARIANT] reports a supported verdict only when the conservative arm beats the baseline above zero", () => {
    expect(isSupported(report(rows, 0.6))).toBe(true);
  });

  it("[INVARIANT] withholds support when there are too few independent day clusters", () => {
    const sameDay = rows.map((r) => ({ ...r, detectedAt: "2026-08-27T00:00:00.000Z" }));
    const r = report(sameDay, 0.6);
    expect(r.conservative.bootstrap.status).toBe("insufficient_clusters");
    expect(isSupported(r)).toBe(false);
  });

  it("[INVARIANT] withholds support when the proposal does not beat the live rule", () => {
    const allAmbiguous = rows.map((r) => (r.outcome === "win" ? { ...r, maeR: 0.95 } : r));
    expect(isSupported(report(allAmbiguous, 0.6))).toBe(false);
  });
});

describe("evaluateBreakevenStop", () => {
  it("[INVARIANT] refuses to answer and names the measurement it lacks", () => {
    const r = evaluateBreakevenStop(0.7);
    expect(r.decidable).toBe(false);
    expect(r.rule).toBe("breakeven_stop@0.7R");
    expect(r.missing).toContain("bar-level post-entry price path");
  });
});
