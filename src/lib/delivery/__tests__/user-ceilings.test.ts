/**
 * Owner-configured spread / slippage / exposure ceilings.
 *
 * Every input in these cases is either broker-derived (bid, ask, point, digits)
 * or owner-configured. Nothing is fabricated, and the cases assert the honest
 * behaviour: a configured ceiling that cannot be measured refuses.
 */
import { describe, expect, it } from "vitest";

import {
  exposurePercentWithinCeiling,
  pipSizeFromSpec,
  readCeilingSettings,
  slippageWithinUserCeiling,
  spreadWithinUserCeiling,
} from "../user-ceilings";

describe("readCeilingSettings", () => {
  it("[UNIT] treats absent, zero and negative values as disabled", () => {
    const s = readCeilingSettings({
      max_entry_spread_pips: 0,
      max_entry_slippage_pips: -5,
      max_total_exposure_percent: null,
    });
    expect(s).toEqual({
      maxEntrySpreadPips: 0,
      maxEntrySlippagePips: 0,
      maxTotalExposurePercent: 0,
      exposureCeilingEnforced: false,
    });
  });

  it("[UNIT] clamps absurd values instead of trusting them", () => {
    const s = readCeilingSettings({
      max_entry_spread_pips: 99_999,
      max_total_exposure_percent: 5_000,
      exposure_limit_enabled: true,
    });
    expect(s.maxEntrySpreadPips).toBe(10_000);
    expect(s.maxTotalExposurePercent).toBe(100);
    expect(s.exposureCeilingEnforced).toBe(true);
  });
});

describe("pipSizeFromSpec", () => {
  it("[UNIT] reads a 5-digit FX pip as ten broker points", () => {
    expect(pipSizeFromSpec({ point: 0.00001, digits: 5 })).toBeCloseTo(0.0001, 10);
  });

  it("[UNIT] reads a 2-digit instrument pip as one point", () => {
    expect(pipSizeFromSpec({ point: 0.01, digits: 2 })).toBeCloseTo(0.01, 10);
  });

  it("[UNIT] returns null when the broker published neither point nor digits", () => {
    expect(pipSizeFromSpec({ point: null, digits: null })).toBeNull();
    expect(pipSizeFromSpec(null)).toBeNull();
  });
});

describe("spreadWithinUserCeiling", () => {
  const pip = 0.0001;

  it("[UNIT] passes when the limit is not configured", () => {
    expect(spreadWithinUserCeiling(0, null, 1.1, 1.2).ok).toBe(true);
  });

  it("[UNIT] passes a spread inside the owner's limit", () => {
    expect(spreadWithinUserCeiling(2, pip, 1.1, 1.10015).ok).toBe(true);
  });

  it("[UNIT] refuses a spread above the owner's limit", () => {
    const v = spreadWithinUserCeiling(1, pip, 1.1, 1.1003);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.detail).toContain("above your 1 pip limit");
  });

  it("[UNIT] refuses rather than passing when the pip size is unknown", () => {
    expect(spreadWithinUserCeiling(1, null, 1.1, 1.1001).ok).toBe(false);
  });
});

describe("slippageWithinUserCeiling", () => {
  const pip = 0.0001;

  it("[UNIT] passes when price is close to the published entry", () => {
    expect(slippageWithinUserCeiling(3, pip, 1.2, 1.2002).ok).toBe(true);
  });

  it("[UNIT] refuses when price has moved past the owner's tolerance", () => {
    const v = slippageWithinUserCeiling(2, pip, 1.2, 1.2005);
    expect(v.ok).toBe(false);
  });

  it("[UNIT] refuses when the pip size is unknown", () => {
    expect(slippageWithinUserCeiling(2, null, 1.2, 1.2001).ok).toBe(false);
  });
});

describe("exposurePercentWithinCeiling", () => {
  const none = { knownPercent: 0, unknownOrders: 0 };

  it("[UNIT] is disabled when no ceiling is configured", () => {
    expect(exposurePercentWithinCeiling(0, true, none, null).ok).toBe(true);
  });

  it("[UNIT] refuses when the incoming order's risk percent is unknown", () => {
    const v = exposurePercentWithinCeiling(2, true, none, null);
    expect(v.ok).toBe(false);
  });

  it("[UNIT] allows a total inside the ceiling", () => {
    const v = exposurePercentWithinCeiling(2, true, { knownPercent: 1, unknownOrders: 0 }, 0.5);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.totalPercent).toBeCloseTo(1.5, 10);
  });

  it("[UNIT] blocks an over-ceiling total when enforcement is on", () => {
    const v = exposurePercentWithinCeiling(1, true, { knownPercent: 0.8, unknownOrders: 0 }, 0.5);
    expect(v.ok).toBe(false);
  });

  it("[UNIT] reports but does not block when enforcement is off", () => {
    const v = exposurePercentWithinCeiling(1, false, { knownPercent: 0.8, unknownOrders: 0 }, 0.5);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.detail).toContain("above your 1% limit");
  });

  it("[UNIT] says out loud that unrecorded earlier orders make the total a floor", () => {
    const v = exposurePercentWithinCeiling(1, true, { knownPercent: 0.9, unknownOrders: 2 }, 0.5);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.detail).toContain("2 earlier orders carry no recorded risk figure");
  });
});
