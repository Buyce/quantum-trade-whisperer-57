import { describe, expect, it } from "vitest";
import {
  HEALTHY_EQUITY_MAX_AGE_MS,
  assessFreshness,
  describeCeilings,
  effectiveCeilings,
} from "../adaptive-ceilings";

const NOW = Date.parse("2026-01-05T12:00:00.000Z");
const at = (agoMs: number) => new Date(NOW - agoMs).toISOString();

describe("assessFreshness", () => {
  it("[INVARIANT] treats a missing equity observation as unknown, never healthy", () => {
    expect(assessFreshness({ equityObservedAt: null, now: NOW }).health).toBe("unknown");
    expect(assessFreshness({ equityObservedAt: "not-a-date", now: NOW }).health).toBe("unknown");
  });

  it("[INVARIANT] treats a future equity timestamp as unknown", () => {
    expect(assessFreshness({ equityObservedAt: at(-10 * 60_000), now: NOW }).health).toBe("unknown");
  });

  it("[INVARIANT] degrades once the equity observation passes the healthy age", () => {
    expect(assessFreshness({ equityObservedAt: at(HEALTHY_EQUITY_MAX_AGE_MS - 1), now: NOW }).health).toBe(
      "healthy",
    );
    expect(assessFreshness({ equityObservedAt: at(HEALTHY_EQUITY_MAX_AGE_MS + 1), now: NOW }).health).toBe(
      "degraded",
    );
  });

  it("[INVARIANT] degrades on a stale or unreadable known quote time", () => {
    expect(
      assessFreshness({ equityObservedAt: at(1000), quoteObservedAt: at(600_000), now: NOW }).health,
    ).toBe("degraded");
    expect(
      assessFreshness({ equityObservedAt: at(1000), quoteObservedAt: "nope", now: NOW }).health,
    ).toBe("degraded");
    expect(
      assessFreshness({ equityObservedAt: at(1000), quoteObservedAt: at(1000), now: NOW }).health,
    ).toBe("healthy");
  });
});

describe("effectiveCeilings", () => {
  const base = {
    dailyBase: 10,
    perSymbolBase: 4,
    adaptiveMax: 20,
    adaptiveFloor: 2,
  };

  it("[INVARIANT] leaves the owner's fixed ceilings untouched when adaptive mode is off", () => {
    const c = effectiveCeilings({ ...base, adaptiveEnabled: false, health: "healthy" });
    expect(c).toMatchObject({ daily: 10, perSymbol: 4, applied: "fixed" });
  });

  it("[INVARIANT] never raises above the owner's adaptive maximum or the hard 25 bound", () => {
    const c = effectiveCeilings({
      ...base,
      adaptiveMax: 999,
      adaptiveEnabled: true,
      health: "healthy",
    });
    expect(c.daily).toBe(25);
    expect(c.perSymbol).toBe(25);
  });

  it("[INVARIANT] never lowers a raised ceiling below the fixed base", () => {
    const c = effectiveCeilings({
      ...base,
      adaptiveMax: 3,
      adaptiveEnabled: true,
      health: "healthy",
    });
    expect(c.daily).toBe(10);
    expect(c.perSymbol).toBe(4);
  });

  it("[INVARIANT] reduces toward the floor on degraded AND unknown freshness", () => {
    for (const health of ["degraded", "unknown"] as const) {
      const c = effectiveCeilings({ ...base, adaptiveEnabled: true, health });
      expect(c).toMatchObject({ daily: 2, perSymbol: 2, applied: "adaptive_reduced" });
    }
  });

  it("[INVARIANT] keeps a ceiling the owner switched off at zero in every direction", () => {
    for (const health of ["healthy", "degraded", "unknown"] as const) {
      const c = effectiveCeilings({
        dailyBase: 0,
        perSymbolBase: 0,
        adaptiveEnabled: true,
        adaptiveMax: 25,
        adaptiveFloor: 5,
        health,
      });
      expect(c.daily).toBe(0);
      expect(c.perSymbol).toBe(0);
    }
  });

  it("[INVARIANT] describes the ceiling in force without implying broker state", () => {
    const text = describeCeilings(
      effectiveCeilings({ ...base, adaptiveEnabled: true, health: "unknown" }),
      "no readable broker equity observation",
    );
    expect(text).toContain("adaptive limits reduced");
    expect(text).toContain("no readable broker equity observation");
  });
});
