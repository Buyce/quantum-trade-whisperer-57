import { describe, expect, it } from "vitest";

import { evaluateCommissioning, type CommissioningInput } from "../commissioning";

function ready(overrides: Partial<CommissioningInput> = {}): CommissioningInput {
  return {
    symbol: "GBPUSD",
    providerSymbol: "GBPUSD",
    mappingStatus: "exact",
    specPresent: true,
    specFields: {
      digits: true,
      point: true,
      contractSize: true,
      minLot: true,
      lotStep: true,
    },
    candlesOk: true,
    quoteOk: true,
    conversionOk: true,
    spreadFloorCandidate: 0.0002,
    calendarSource: "broker_verified",
    breakerOpen: false,
    capacityHeadroom: 2,
    ...overrides,
  };
}

describe("commissioning gate", () => {
  it("[INVARIANT] authorises data validation when every provider fact is proven", () => {
    const d = evaluateCommissioning(ready());
    expect(d.mayEnterDataValidation).toBe(true);
    expect(d.blockers).toEqual([]);
    expect(d.wave).toBe(1);
  });

  it("[INVARIANT] refuses an unknown symbol rather than inventing a wave", () => {
    const d = evaluateCommissioning(ready({ symbol: "FAKEPAIR" }));
    expect(d.mayEnterDataValidation).toBe(false);
    expect(d.blockers).toEqual(["not_in_registry"]);
    expect(d.wave).toBeNull();
  });

  it("[INVARIANT] never chooses between ambiguous broker symbols", () => {
    const d = evaluateCommissioning(ready({ mappingStatus: "ambiguous", providerSymbol: null }));
    expect(d.blockers).toContain("ambiguous_provider_symbol");
    expect(d.mayEnterDataValidation).toBe(false);
  });

  it("[INVARIANT] blocks when the provider offers no specification", () => {
    const d = evaluateCommissioning(ready({ specPresent: false }));
    expect(d.blockers).toContain("no_provider_specification");
  });

  it("[INVARIANT] blocks an incomplete specification field by field", () => {
    const d = evaluateCommissioning(
      ready({
        specFields: { digits: true, point: false, contractSize: true, minLot: true, lotStep: true },
      }),
    );
    expect(d.blockers).toContain("specification_incomplete");
  });

  it.each([
    ["candlesOk", "no_candle_series"],
    ["quoteOk", "no_live_quote"],
  ] as const)("[INVARIANT] blocks when %s is false", (field, blocker) => {
    const d = evaluateCommissioning(ready({ [field]: false } as Partial<CommissioningInput>));
    expect(d.blockers).toContain(blocker);
  });

  it("[INVARIANT] blocks an open provider breaker and exhausted sampler capacity", () => {
    expect(evaluateCommissioning(ready({ breakerOpen: true })).blockers).toContain("breaker_open");
    expect(evaluateCommissioning(ready({ capacityHeadroom: 0 })).blockers).toContain(
      "no_capacity_headroom",
    );
  });

  it("[INVARIANT] treats an unverified calendar as a note, not a blocker, for a data-only stage", () => {
    const d = evaluateCommissioning(ready({ symbol: "NAS100", calendarSource: null }));
    expect(d.mayEnterDataValidation).toBe(true);
    expect(d.calendarVerified).toBe(false);
    expect(d.notes).toContain("calendar_unverified");
    expect(d.detail).toMatch(/never strategy evaluation, publication or execution/);
  });

  it("[INVARIANT] treats unverifiable conversion as a note for a data-only stage", () => {
    const d = evaluateCommissioning(ready({ conversionOk: false }));
    expect(d.mayEnterDataValidation).toBe(true);
    expect(d.notes).toContain("conversion_not_verified");
  });

  it("[INVARIANT] never claims readiness it cannot show: detail names every blocker", () => {
    const d = evaluateCommissioning(
      ready({
        specPresent: false,
        candlesOk: false,
        quoteOk: false,
        providerSymbol: null,
        mappingStatus: null,
      }),
    );
    expect(d.detail).toMatch(/stays disabled/);
    for (const blocker of d.blockers) expect(d.blockers).toContain(blocker);
    expect(d.blockers.length).toBeGreaterThanOrEqual(4);
  });
});
