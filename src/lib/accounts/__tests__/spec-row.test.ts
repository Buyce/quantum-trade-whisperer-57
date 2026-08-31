import { describe, expect, it } from "vitest";

import {
  buildAccountSpecRow,
  needsSpecRefresh,
  SPEC_REFRESH_AFTER_MS,
} from "@/lib/accounts/spec-row";
import { ACCOUNT_SPEC_MAX_AGE_MS } from "@/lib/accounts/specs.server";

const NOW = Date.parse("2026-08-31T12:00:00.000Z");

describe("buildAccountSpecRow", () => {
  it("[INVARIANT] keeps broker point and reports its source", () => {
    const row = buildAccountSpecRow({
      accountId: "a",
      userId: "u",
      brokerSymbol: "XAUUSD.s",
      canonicalSymbol: "XAUUSD",
      platform: "mt5",
      spec: { point: 0.01, digits: 2, contractSize: 100, tickSize: 0.01 },
      fetchedAt: "2026-08-31T12:00:00.000Z",
    });
    expect(row["point"]).toBe(0.01);
    expect(row["point_source"]).toBe("broker_point");
    expect(row["broker_symbol"]).toBe("XAUUSD.s");
    expect(row["canonical_symbol"]).toBe("XAUUSD");
  });

  it("[INVARIANT] derives point from digits only when the broker omits it, and never defaults a missing field", () => {
    const row = buildAccountSpecRow({
      accountId: "a",
      userId: "u",
      brokerSymbol: "EURUSD",
      canonicalSymbol: "EURUSD",
      platform: "mt5",
      spec: { digits: 5 },
      fetchedAt: "2026-08-31T12:00:00.000Z",
    });
    expect(row["point"]).toBeCloseTo(1e-5, 12);
    expect(row["point_source"]).toBe("derived_from_digits");
    expect(row["contract_size"]).toBeNull();
    expect(row["stops_level"]).toBeNull();
    expect(row["volume_step"]).toBeNull();
  });

  it("[INVARIANT] leaves point unknown when neither point nor digits is published", () => {
    const row = buildAccountSpecRow({
      accountId: "a",
      userId: "u",
      brokerSymbol: "EURUSD",
      canonicalSymbol: "EURUSD",
      platform: "mt4",
      spec: {},
      fetchedAt: "2026-08-31T12:00:00.000Z",
    });
    expect(row["point"]).toBeNull();
    expect(row["point_source"]).toBeNull();
  });
});

describe("needsSpecRefresh", () => {
  const base = { newestFetchedAt: new Date(NOW).toISOString(), storedSymbols: 3, mappedSymbols: 3 };

  it("[INVARIANT] leaves a fresh account alone", () => {
    expect(needsSpecRefresh(base, NOW + 60_000)).toBe(false);
  });

  it("[INVARIANT] refreshes once past the refresh age", () => {
    expect(needsSpecRefresh(base, NOW + SPEC_REFRESH_AFTER_MS)).toBe(true);
  });

  it("[INVARIANT] refreshes well before the execution trust bound expires", () => {
    expect(SPEC_REFRESH_AFTER_MS).toBeLessThan(ACCOUNT_SPEC_MAX_AGE_MS);
    // A single missed pass must still leave the specification usable.
    expect(2 * SPEC_REFRESH_AFTER_MS).toBeLessThanOrEqual(ACCOUNT_SPEC_MAX_AGE_MS);
  });

  it("[INVARIANT] refreshes when nothing is stored, coverage is incomplete, or the time is unreadable", () => {
    expect(needsSpecRefresh({ ...base, storedSymbols: 0 }, NOW)).toBe(true);
    expect(needsSpecRefresh({ ...base, storedSymbols: 2, mappedSymbols: 3 }, NOW)).toBe(true);
    expect(needsSpecRefresh({ ...base, newestFetchedAt: null }, NOW)).toBe(true);
    expect(needsSpecRefresh({ ...base, newestFetchedAt: "not a date" }, NOW)).toBe(true);
  });
});
