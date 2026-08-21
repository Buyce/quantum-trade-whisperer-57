/**
 * Characterisation tests for the locked V3 geometry rules. These pin the
 * research model's arithmetic so any future drift is a visible failure.
 */
import { describe, expect, it } from "vitest";
import { maxAcceptableEntryV3, minRatioForMaxR, slippageAllowance } from "../slippage";
import { MODEL_V3_CODE_HASH, MODEL_V3_PARAMS } from "../manifest";

const r = 10; // risk in price terms; the rule is scale-free in R
const d = (maxR: number) =>
  slippageAllowance({ risk: r, maxR, minRatio: minRatioForMaxR(maxR) });

describe("V3 target-preserving slippage allowance", () => {
  it("gives zero allowance (limit-only entry) when maxR = 1.6", () => {
    // maxR 1.6 >= 1.5 so the full ratio floor m = 2 applies, and k = 1.6 <= m,
    // so there is no room to widen the entry without breaking the ratio floor.
    expect(d(1.6)).toBe(0);
  });

  it("is zero at exactly k = m", () => {
    expect(d(2)).toBe(0);
  });

  it("binds on the ratio term when it is tighter than the cap", () => {
    // k = 2.3, m = 2 => 10*0.3/3 = 1.0 < the 0.15R = 1.5 cap.
    expect(d(2.3)).toBeCloseTo(1.0, 6);
  });

  it("binds on the 0.15R cap once the ratio term is looser", () => {
    // k = 2.5, m = 2 => 10*0.5/3 = 1.667, so the cap wins.
    expect(d(2.5)).toBeCloseTo(1.5, 6);
  });

  it("never exceeds the 0.15R cap for a wide extension", () => {
    expect(d(8)).toBeLessThanOrEqual(0.15 * r + 1e-9);
  });

  it("uses the thin ratio floor below maxR 1.5", () => {
    // k = 1.4 < 1.5 => m = 1 => 10*0.4/2 = 2.0, capped to 1.5.
    expect(d(1.4)).toBeCloseTo(1.5, 6);
  });

  it("keeps the realised ratio at or above the floor at the allowance limit", () => {
    for (const maxR of [1.2, 1.4, 1.6, 2, 2.3, 3, 5]) {
      const allowance = d(maxR);
      const floor = minRatioForMaxR(maxR);
      const realised = (maxR * r - allowance) / (r + allowance);
      if (allowance > 0) expect(realised).toBeGreaterThanOrEqual(floor - 1e-9);
    }
  });

  it("fails closed on degenerate inputs", () => {
    expect(slippageAllowance({ risk: 0, maxR: 5, minRatio: 2 })).toBe(0);
    expect(slippageAllowance({ risk: Number.NaN, maxR: 5, minRatio: 2 })).toBe(0);
  });
});

describe("V3 max acceptable entry", () => {
  it("returns the entry itself, flagged limit-only, at maxR 1.6", () => {
    const long = maxAcceptableEntryV3({
      entryPrice: 1.1,
      stopLoss: 1.098,
      maxR: 1.6,
      direction: "long",
    });
    expect(long.limitOnly).toBe(true);
    expect(long.price).toBeCloseTo(1.1, 10);
  });

  it("widens away from the stop for both directions", () => {
    const long = maxAcceptableEntryV3({
      entryPrice: 1.1,
      stopLoss: 1.098,
      maxR: 3,
      direction: "long",
    });
    const short = maxAcceptableEntryV3({
      entryPrice: 1.1,
      stopLoss: 1.102,
      maxR: 3,
      direction: "short",
    });
    expect(long.price).toBeGreaterThan(1.1);
    expect(short.price).toBeLessThan(1.1);
    expect(long.allowance).toBeCloseTo(short.allowance, 12);
  });
});

describe("V3 manifest", () => {
  it("locks the stop window to the retracement leg and disables the offset", () => {
    expect(MODEL_V3_PARAMS.stop.window).toContain("bIndex + 1");
    expect(MODEL_V3_PARAMS.entry.dynamicOffset).toContain("disabled");
  });

  it("is registered under a stable code hash", () => {
    expect(MODEL_V3_CODE_HASH).toBe("3c327b029da38563");
  });

  it("never contributes to live priors", () => {
    expect(MODEL_V3_PARAMS.policy.published).toBe(false);
    expect(MODEL_V3_PARAMS.policy.priors).toContain("never");
  });
});
