/**
 * Phase A2A remediation gates (R2-FIX, R3-FIX).
 *
 * Two invariants are pinned here because both protect money:
 *   - a DEGRADED lifecycle read must refuse every symbol outside the frozen
 *     Wave 0 universe, instead of degrading to "allowed";
 *   - broker-bound prices are snapped BY ROLE, so a stop never drifts closer to
 *     entry and a target never drifts nearer than the plan intended.
 */
import { describe, expect, it } from "vitest";
import { lifecycleAllows } from "../lifecycle";
import { normalizeOrderGeometry } from "../precision";

const WAVE1 = "USDJPY";
const WAVE0 = "EURUSD";

describe("[UNIT] lifecycle gate under a degraded read", () => {
  const degraded = { enforced: false, degraded: true, stages: null };

  it("[UNIT] refuses execution for a Wave 1 symbol when the stage is unreadable", () => {
    const verdict = lifecycleAllows(degraded, WAVE1, "execute");
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain(WAVE1);
  });

  it("[UNIT] refuses publication and research capture for a Wave 1 symbol too", () => {
    expect(lifecycleAllows(degraded, WAVE1, "publish").allowed).toBe(false);
    expect(lifecycleAllows(degraded, WAVE1, "capture_research").allowed).toBe(false);
    expect(lifecycleAllows(degraded, WAVE1, "collect_data").allowed).toBe(false);
  });

  it("[UNIT] still allows the frozen Wave 0 universe, so an outage cannot halt production", () => {
    expect(lifecycleAllows(degraded, WAVE0, "execute").allowed).toBe(true);
    expect(lifecycleAllows(degraded, WAVE0, "publish").allowed).toBe(true);
  });

  it("[UNIT] defers to the stage once the read succeeds and enforcement is on", () => {
    const view = { enforced: true, degraded: false, stages: { [WAVE1]: "shadow" as const } };
    expect(lifecycleAllows(view, WAVE1, "capture_research").allowed).toBe(true);
    expect(lifecycleAllows(view, WAVE1, "publish").allowed).toBe(false);
    expect(lifecycleAllows(view, WAVE1, "execute").allowed).toBe(false);
  });
});

describe("[UNIT] role-aware order geometry", () => {
  const spec = { tickSize: 0.001, point: 0.001, digits: 3 } as never;

  it("[UNIT] never moves a long stop closer to entry, nor a target nearer", () => {
    const g = normalizeOrderGeometry({
      spec,
      direction: "long",
      entryPrice: 151.23456,
      stopLoss: 150.98712,
      tp1: 151.71234,
      tp2: 152.01111,
      tp3: null,
    });
    expect(g.stopLoss).toBeLessThanOrEqual(150.98712);
    expect(g.tp1).toBeGreaterThanOrEqual(151.71234);
    expect(g.tick).toBe(0.001);
  });

  it("[UNIT] never moves a short stop closer to entry, nor a target nearer", () => {
    const g = normalizeOrderGeometry({
      spec,
      direction: "short",
      entryPrice: 151.23456,
      stopLoss: 151.48712,
      tp1: 150.71234,
      tp2: 150.41111,
      tp3: null,
    });
    expect(g.stopLoss).toBeGreaterThanOrEqual(151.48712);
    expect(g.tp1).toBeLessThanOrEqual(150.71234);
  });

  it("[UNIT] reports an unknown grid rather than inventing a tick size", () => {
    const g = normalizeOrderGeometry({
      spec: null,
      direction: "long",
      entryPrice: 1.2345678,
      stopLoss: 1.2300001,
      tp1: 1.24,
      tp2: 1.25,
      tp3: null,
    });
    expect(g.tick).toBeNull();
    expect(g.source).toBe("unnormalized");
    expect(g.entryPrice).toBe(1.2345678);
  });
});
