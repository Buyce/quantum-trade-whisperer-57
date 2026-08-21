/**
 * Characterisation tests for the locked V3 geometry rules. These pin the
 * research model's arithmetic so any future drift is a visible failure.
 */
import { describe, expect, it } from "vitest";
import { slippageAllowance } from "../slippage";
import { MODEL_V3_CODE_HASH, MODEL_V3_PARAMS } from "../manifest";

describe("V3 target-preserving slippage allowance", () => {
  const r = 10; // risk in price terms; the rule is scale-free in R

  it("gives zero allowance (limit-only entry) when maxR = 1.6", () => {
    // maxR 1.6 >= 1.5 so the full ratio floor m = 2 applies, and k = 1.6 <= m,
    // so there is no room to widen the entry without breaking the ratio floor.
    const d = slippageAllowance({ riskPrice: r, maxR: 1.6 });
    expect(d).toBe(0);
  });

  it("is zero at exactly k = m", () => {
    expect(slippageAllowance({ riskPrice: r, maxR: 2 })).toBe(0);
  });

  it("preserves the ratio floor rather than the raw cap when k is modest", () => {
    // k = 2.5, m = 2 => d = r*(k-m)/(1+m) = 10*0.5/3 = 1.6667, below the
    // 0.15R = 1.5 cap? No: 1.6667 > 1.5, so the cap binds.
    const d = slippageAllowance({ riskPrice: r, maxR: 2.5 });
    expect(d).toBeCloseTo(1.5, 6);
  });

  it("binds on the ratio term when it is tighter than the cap", () => {
    // k = 2.3, m = 2 => 10*0.3/3 = 1.0 < 1.5 cap.
    const d = slippageAllowance({ riskPrice: r, maxR: 2.3 });
    expect(d).toBeCloseTo(1.0, 6);
  });

  it("never exceeds the 0.15R cap for a wide extension", () => {
    const d = slippageAllowance({ riskPrice: r, maxR: 8 });
    expect(d).toBeLessThanOrEqual(0.15 * r + 1e-9);
  });

  it("uses the thin ratio floor below maxR 1.5", () => {
    // k = 1.4 < 1.5 => m = 1 => d = 10*0.4/2 = 2.0, capped to 1.5.
    const d = slippageAllowance({ riskPrice: r, maxR: 1.4 });
    expect(d).toBeCloseTo(1.5, 6);
  });

  it("keeps the realised ratio at or above the floor at the allowance limit", () => {
    for (const maxR of [1.2, 1.4, 1.6, 2, 2.3, 3, 5]) {
      const d = slippageAllowance({ riskPrice: r, maxR });
      const floor = maxR < 1.5 ? 1 : 2;
      const realised = (maxR * r - d) / (r + d);
      expect(realised).toBeGreaterThanOrEqual(Math.min(floor, maxR) - 1e-9);
    }
  });
});

describe("V3 manifest", () => {
  it("locks the stop window to the retracement leg", () => {
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
