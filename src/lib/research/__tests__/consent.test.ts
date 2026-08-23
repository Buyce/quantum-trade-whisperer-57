import { describe, expect, it } from "vitest";

import {
  HOLDOUT_AVAILABLE,
  isSafeResearchRef,
  newsContextFor,
  phaseChangeAllowed,
  pooledInclusionAllowed,
  RESEARCH_CONSENT_VERSION,
} from "../consent";
import { collapseCustomerExecutions, compareShadowToBroker } from "../sample";

const consented = {
  researchConsent: true,
  researchConsentVersion: RESEARCH_CONSENT_VERSION,
  researchConsentAt: "2026-08-20T09:00:00.000Z",
};

describe("pooled broker research consent", () => {
  it("[INVARIANT] consent defaults to refused when nothing was recorded", () => {
    const verdict = pooledInclusionAllowed({
      researchConsent: null,
      researchConsentVersion: null,
      researchConsentAt: null,
    });
    expect(verdict.included).toBe(false);
  });

  it("[INVARIANT] explicit consent at the current version includes future evidence", () => {
    expect(pooledInclusionAllowed(consented).included).toBe(true);
  });

  it("[INVARIANT] withdrawing consent stops future inclusion", () => {
    expect(pooledInclusionAllowed({ ...consented, researchConsent: false }).included).toBe(false);
  });

  it("[INVARIANT] consent given for an older text version is not current consent", () => {
    const verdict = pooledInclusionAllowed({
      ...consented,
      researchConsentVersion: RESEARCH_CONSENT_VERSION - 1,
    });
    expect(verdict.included).toBe(false);
    if (!verdict.included) expect(verdict.reason).toContain("version");
  });

  it("[INVARIANT] consent without a usable timestamp is refused", () => {
    expect(pooledInclusionAllowed({ ...consented, researchConsentAt: "nonsense" }).included).toBe(
      false,
    );
    expect(pooledInclusionAllowed({ ...consented, researchConsentAt: null }).included).toBe(false);
  });
});

describe("pseudonymous research identity", () => {
  const userId = "8f14e45f-ceea-467a-9575-0a0b0c0d0e0f";
  const login = "5053558014";
  const metaapiId = "f6a72106-7709-4835-8022-75cad470a505";

  it("[INVARIANT] a research reference contains no user id, login, email or broker account id", () => {
    const ref = "ra_0123456789abcdef0123456789abcdef";
    expect(isSafeResearchRef(ref, [userId, login, metaapiId, "trader@example.com"])).toBe(true);
  });

  it("[INVARIANT] anything embedding a real identifier is rejected", () => {
    expect(isSafeResearchRef(`ra_${"0".repeat(32)}`.replace("0000000000", login), [login])).toBe(
      false,
    );
    expect(isSafeResearchRef(userId)).toBe(false);
    expect(isSafeResearchRef("trader@example.com")).toBe(false);
    expect(isSafeResearchRef(null)).toBe(false);
    expect(isSafeResearchRef("account-1")).toBe(false);
  });
});

describe("evidence phase and news context", () => {
  it("[INVARIANT] a phase may be set before an outcome and never after one", () => {
    expect(phaseChangeAllowed(false)).toBe(true);
    expect(phaseChangeAllowed(true)).toBe(false);
  });

  it("[INVARIANT] news context stays unknown while no verified calendar provider exists", () => {
    expect(newsContextFor()).toBe("unknown");
  });

  it("[INVARIANT] no out-of-sample holdout is claimed", () => {
    expect(HOLDOUT_AVAILABLE).toBe(false);
  });
});

describe("customer execution sample size", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    signalId: "signal-1",
    researchRef: `ra_${String(i).padStart(32, "0")}`,
    detectedAt: "2026-08-22T08:30:00.000Z",
    rVsPlan: 1.4,
    rVsActualRisk: 1.2,
    slippage: 0.2,
    filled: true,
  }));

  it("[INVARIANT] 1 signal x 100 executions is 1 signal-edge and 100 execution-quality observations", () => {
    const sample = collapseCustomerExecutions(rows);
    expect(sample.signalEdgeObservations).toBe(1);
    expect(sample.executionQualityObservations).toBe(100);
    expect(sample.signalEdge[0]?.executions).toBe(100);
    expect(sample.signalEdge[0]?.accounts).toBe(100);
  });

  it("[INVARIANT] collapsed observations preserve the whole-UTC-day clustering unit", () => {
    const sample = collapseCustomerExecutions([
      ...rows,
      { ...rows[0]!, signalId: "signal-2", detectedAt: "2026-08-23T23:59:59.000Z" },
      { ...rows[0]!, signalId: "signal-3", detectedAt: "2026-08-23T00:00:01.000Z" },
    ]);
    expect(sample.signalEdgeObservations).toBe(3);
    expect(sample.utcDays).toBe(2);
    expect(sample.signalEdge.map((s) => s.utcDay)).toContain("2026-08-23");
  });

  it("[UNIT] the median R of one setup is not the sum of its executions", () => {
    const sample = collapseCustomerExecutions([
      { ...rows[0]!, rVsPlan: 1 },
      { ...rows[0]!, rVsPlan: 3 },
    ]);
    expect(sample.signalEdge[0]?.rVsPlan).toBe(2);
  });
});

describe("shadow replay versus broker reality", () => {
  it("[UNIT] compares fills, slippage and R without merging into either population", () => {
    const comparison = compareShadowToBroker([
      {
        signalId: "s1",
        shadowFilled: true,
        brokerFilled: true,
        shadowEntry: 1.1,
        brokerEntry: 1.102,
        shadowR: 1,
        brokerR: 0.9,
      },
      {
        signalId: "s2",
        shadowFilled: true,
        brokerFilled: false,
        shadowEntry: 2,
        brokerEntry: null,
        shadowR: 1,
        brokerR: null,
      },
    ]);
    expect(comparison.compared).toBe(2);
    expect(comparison.fillAgreement).toBeCloseTo(0.5);
    expect(comparison.meanSlippage).toBeCloseTo(0.002, 6);
    expect(comparison.meanRDifference).toBeCloseTo(-0.1, 6);
    expect(comparison.unusable).toBe(1);
  });

  it("[INVARIANT] an empty comparison reports nothing rather than agreement", () => {
    const comparison = compareShadowToBroker([]);
    expect(comparison.fillAgreement).toBeNull();
    expect(comparison.meanSlippage).toBeNull();
  });
});
