import { describe, expect, it } from "vitest";

import {
  MAX_TIGHTENING,
  effectiveSpreadCeiling,
  spreadNorm,
  type SpreadNormRow,
} from "@/lib/delivery/spread-norms";

const day = (d: number, p90: number, samples = 12): SpreadNormRow => ({
  tradingDate: `2026-09-${String(d).padStart(2, "0")}`,
  validSamples: samples,
  p90SpreadPrice: p90,
});

describe("spreadNorm", () => {
  it("refuses to claim a norm from too few trading days", () => {
    const norm = spreadNorm([day(1, 0.00002), day(2, 0.00002)]);
    expect(norm.measured).toBe(false);
  });

  it("refuses to claim a norm from too few samples", () => {
    const norm = spreadNorm([1, 2, 3, 4, 5].map((d) => day(d, 0.00002, 2)));
    expect(norm.measured).toBe(false);
  });

  it("ignores rows with no usable p90", () => {
    const norm = spreadNorm([
      ...[1, 2, 3, 4, 5].map((d) => day(d, 0.00002)),
      { tradingDate: "2026-09-06", validSamples: 10, p90SpreadPrice: null },
    ]);
    expect(norm.measured).toBe(true);
    if (norm.measured) expect(norm.medianP90Price).toBeCloseTo(0.00002, 10);
  });
});

describe("effectiveSpreadCeiling", () => {
  const measured = spreadNorm([1, 2, 3, 4, 5].map((d) => day(d, 0.00002)));

  it("leaves a disabled gate disabled", () => {
    expect(effectiveSpreadCeiling(0, 0.0001, measured).pips).toBe(0);
  });

  it("never widens the owner's ceiling", () => {
    const wide = spreadNorm([1, 2, 3, 4, 5].map((d) => day(d, 0.005)));
    const out = effectiveSpreadCeiling(2, 0.0001, wide);
    expect(out.pips).toBe(2);
    expect(out.tightened).toBe(false);
  });

  it("tightens when the instrument's own normal spread is tighter", () => {
    const out = effectiveSpreadCeiling(3, 0.0001, measured);
    expect(out.tightened).toBe(true);
    expect(out.pips).toBeLessThan(3);
    expect(out.pips).toBeGreaterThanOrEqual(3 * MAX_TIGHTENING);
  });

  it("never tightens below the bounded floor", () => {
    const tiny = spreadNorm([1, 2, 3, 4, 5].map((d) => day(d, 0.0000001)));
    expect(effectiveSpreadCeiling(4, 0.0001, tiny).pips).toBe(4 * MAX_TIGHTENING);
  });

  it("does nothing without a measured norm or without a pip size", () => {
    const unmeasured = spreadNorm([day(1, 0.00002)]);
    expect(effectiveSpreadCeiling(2, 0.0001, unmeasured).pips).toBe(2);
    expect(effectiveSpreadCeiling(2, null, measured).pips).toBe(2);
  });
});
