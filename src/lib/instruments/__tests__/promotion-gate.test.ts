import { describe, expect, it } from "vitest";

import {
  evaluatePromotion,
  MAX_MISSINGNESS_PCT,
  REQUIRED_TRADING_DAYS,
  REQUIRED_VALID_SAMPLES,
  type PromotionEvidence,
} from "../promotion";

const NOW = Date.parse("2026-09-01T12:00:00Z");

function satisfied(overrides: Partial<PromotionEvidence> = {}): PromotionEvidence {
  return {
    instrument: "GBPUSD",
    stage: "data_validation",
    tradingDays: REQUIRED_TRADING_DAYS,
    validSamples: REQUIRED_VALID_SAMPLES,
    invalidSamples: 3,
    expectedSessions: ["sydney", "tokyo", "london", "london_new_york_overlap", "new_york"],
    coveredSessions: ["sydney", "tokyo", "london", "london_new_york_overlap", "new_york"],
    missingnessPct: 2,
    readiness: {
      ready: true,
      checkedAt: "2026-09-01T11:00:00Z",
      conversionRouteReady: true,
      conversionDataReady: true,
      providerSymbol: "GBPUSD",
      failedChecks: [],
    },
    mappedProviderSymbol: "GBPUSD",
    observedProviderSymbols: ["GBPUSD"],
    spreadFloorCandidate: 0.00004,
    ...overrides,
  };
}

describe("promotion checkpoint gate", () => {
  it("[UNIT] complete evidence is promotable with no blockers", () => {
    const verdict = evaluatePromotion(satisfied(), NOW);
    expect(verdict.promotable).toBe(true);
    expect(verdict.blockers).toEqual([]);
  });

  it("[INVARIANT] no evidence at all is blocked, never assumed satisfied", () => {
    const verdict = evaluatePromotion(
      satisfied({
        tradingDays: 0,
        validSamples: 0,
        invalidSamples: 0,
        coveredSessions: [],
        missingnessPct: null,
        readiness: null,
        mappedProviderSymbol: null,
        observedProviderSymbols: [],
        spreadFloorCandidate: null,
      }),
      NOW,
    );
    expect(verdict.promotable).toBe(false);
    expect(verdict.blockers).toContain("no_spread_evidence");
    expect(verdict.blockers).toContain("no_readiness_snapshot");
    expect(verdict.blockers).toContain("provider_symbol_unverified");
    expect(verdict.blockers).toContain("no_spread_floor_candidate");
  });

  it("[INVARIANT] an unreadable stage blocks instead of defaulting to allowed", () => {
    const verdict = evaluatePromotion(satisfied({ stage: null }), NOW);
    expect(verdict.blockers).toContain("stage_unreadable");
  });

  it("[INVARIANT] one trading day of samples is not enough to start measuring", () => {
    const verdict = evaluatePromotion(satisfied({ tradingDays: 1 }), NOW);
    expect(verdict.blockers).toContain("insufficient_trading_days");
    expect(verdict.reasons.join(" ")).toContain(`${REQUIRED_TRADING_DAYS} required`);
  });

  it("[INVARIANT] an uncovered session blocks and names the session", () => {
    const verdict = evaluatePromotion(
      satisfied({ coveredSessions: ["london", "new_york", "tokyo", "sydney"] }),
      NOW,
    );
    expect(verdict.blockers).toContain("sessions_not_covered");
    expect(verdict.reasons.join(" ")).toContain("london_new_york_overlap");
  });

  it("[INVARIANT] missingness above the ceiling blocks", () => {
    const verdict = evaluatePromotion(
      satisfied({ missingnessPct: MAX_MISSINGNESS_PCT + 0.1 }),
      NOW,
    );
    expect(verdict.blockers).toContain("missingness_too_high");
  });

  it("[INVARIANT] a stale or failed readiness snapshot blocks", () => {
    const stale = evaluatePromotion(
      satisfied({
        readiness: { ...satisfied().readiness!, checkedAt: "2026-08-20T11:00:00Z" },
      }),
      NOW,
    );
    expect(stale.blockers).toContain("readiness_stale");

    const failed = evaluatePromotion(
      satisfied({
        readiness: { ...satisfied().readiness!, ready: false, failedChecks: ["quote"] },
      }),
      NOW,
    );
    expect(failed.blockers).toContain("readiness_failed");
    expect(failed.reasons.join(" ")).toContain("quote");
  });

  it("[INVARIANT] unproven live conversion data blocks even when the route exists", () => {
    const verdict = evaluatePromotion(
      satisfied({ readiness: { ...satisfied().readiness!, conversionDataReady: false } }),
      NOW,
    );
    expect(verdict.blockers).toContain("conversion_data_unproven");
    expect(verdict.blockers).not.toContain("conversion_route_unproven");
  });

  it("[INVARIANT] samples collected under a different provider symbol block promotion", () => {
    const verdict = evaluatePromotion(
      satisfied({ observedProviderSymbols: ["GBPUSD", "GBPUSD.pro"] }),
      NOW,
    );
    expect(verdict.blockers).toContain("provider_symbol_changed");
  });

  it("[INVARIANT] an instrument outside data_validation is not judged promotable here", () => {
    const verdict = evaluatePromotion(satisfied({ stage: "disabled" }), NOW);
    expect(verdict.blockers).toContain("not_in_data_validation");
  });
});
