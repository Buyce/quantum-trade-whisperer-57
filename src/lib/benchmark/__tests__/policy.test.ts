import { describe, expect, it } from "vitest";

import { benchmarkShouldTake } from "../policy";

const base = {
  benchmarkAutoEnabled: true,
  configured: true,
  accountArmed: true,
  alertEligible: true,
  grade: "A",
  alreadyEnqueued: false,
};

describe("benchmark demo policy", () => {
  it("[INVARIANT] takes an alert-eligible published grade when its own switch is on", () => {
    expect(benchmarkShouldTake(base).take).toBe(true);
  });

  it("[INVARIANT] never trades a setup traders were not shown", () => {
    expect(benchmarkShouldTake({ ...base, alertEligible: false }).take).toBe(false);
  });

  it("[INVARIANT] is off unless the dedicated benchmark switch is on", () => {
    expect(benchmarkShouldTake({ ...base, benchmarkAutoEnabled: false }).take).toBe(false);
  });

  it("[INVARIANT] refuses unpublished grades", () => {
    expect(benchmarkShouldTake({ ...base, grade: "C" }).take).toBe(false);
  });

  it("[INVARIANT] one benchmark order per setup", () => {
    expect(benchmarkShouldTake({ ...base, alreadyEnqueued: true }).take).toBe(false);
  });

  it("[INVARIANT] needs a configured, armed benchmark account", () => {
    expect(benchmarkShouldTake({ ...base, configured: false }).take).toBe(false);
    expect(benchmarkShouldTake({ ...base, accountArmed: false }).take).toBe(false);
  });
});
