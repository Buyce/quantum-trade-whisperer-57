import { describe, expect, it } from "vitest";

import {
  evaluateWalkForward,
  MIN_PERIOD_SAMPLES,
  type WalkForwardObservation,
} from "../walk-forward";

/** Build n observations for one arm spread across the given days. */
const build = (
  days: string[],
  arm: "pass" | "fail",
  r: number,
  perDay = 12,
): WalkForwardObservation[] =>
  days.flatMap((day) =>
    Array.from({ length: perDay }, (_, i) => ({
      day,
      cluster: `${day}|INSTR${i % 3}`,
      arm,
      // Small deterministic spread so the cluster-robust interval is finite.
      r: r + (i % 4) * 0.02 - 0.03,
    })),
  );

const DAYS = Array.from({ length: 20 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);

describe("walk-forward confirmation", () => {
  it("[INVARIANT] a single trading day cannot be confirmed out of sample", () => {
    const result = evaluateWalkForward(build(["2026-01-01"], "pass", 0.1));
    expect(result.confirmed).toBe(false);
    expect(result.splitDay).toBeNull();
    expect(result.blockers.join(" ")).toMatch(/later, unseen period/);
  });

  it("[UNIT] splits chronologically and holds later days back", () => {
    const obs = [...build(DAYS, "pass", 0.0), ...build(DAYS, "fail", 0.4)];
    const result = evaluateWalkForward(obs);
    expect(result.splitDay).toBe(DAYS[14]);
    expect(result.train!.lastDay < result.splitDay!).toBe(true);
    expect(result.holdout!.firstDay).toBe(result.splitDay);
  });

  it("[UNIT] confirms a difference reproduced on the held-out days", () => {
    const obs = [...build(DAYS, "pass", 0.0), ...build(DAYS, "fail", 0.4)];
    const result = evaluateWalkForward(obs);
    expect(result.blockers).toEqual([]);
    expect(result.confirmed).toBe(true);
    expect(result.holdout!.deltaR).toBeGreaterThan(0.3);
  });

  it("[INVARIANT] a difference that flips direction out of sample is refused", () => {
    const train = DAYS.slice(0, 14);
    const holdout = DAYS.slice(14);
    const obs = [
      ...build(train, "pass", 0.0),
      ...build(train, "fail", 0.4),
      ...build(holdout, "pass", 0.4),
      ...build(holdout, "fail", 0.0),
    ];
    const result = evaluateWalkForward(obs);
    expect(result.confirmed).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/changes direction/);
  });

  it("[INVARIANT] a holdout difference below the practical threshold is refused", () => {
    const obs = [...build(DAYS, "pass", 0.1), ...build(DAYS, "fail", 0.11)];
    const result = evaluateWalkForward(obs);
    expect(result.confirmed).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/below the/);
  });

  it("[INVARIANT] a thin period is named, never rounded up into a confirmation", () => {
    const obs = [...build(DAYS, "pass", 0.0, 1), ...build(DAYS, "fail", 0.4, 1)];
    const result = evaluateWalkForward(obs);
    expect(result.confirmed).toBe(false);
    expect(result.blockers.join(" ")).toContain(`needs ${MIN_PERIOD_SAMPLES}`);
  });

  it("[INVARIANT] one arm missing entirely blocks rather than assumes zero", () => {
    const result = evaluateWalkForward(build(DAYS, "pass", 0.2));
    expect(result.confirmed).toBe(false);
    expect(result.holdout!.fail.n).toBe(0);
    expect(result.holdout!.fail.meanR).toBeNull();
  });
});
