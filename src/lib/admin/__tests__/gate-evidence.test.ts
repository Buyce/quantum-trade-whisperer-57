import { describe, expect, it } from "vitest";
import { buildGateEvidence, type GateEvidenceThresholds } from "@/lib/admin/gate-evidence";

const T = (over: Partial<GateEvidenceThresholds> = {}): GateEvidenceThresholds => ({
  enabled: true,
  minWinPct: 53,
  minSample: 40,
  minExpectedR: null,
  ...over,
});

describe("gate evidence", () => {
  it("keeps replay, expected R and broker money as separate readings", () => {
    const rows = buildGateEvidence(
      T(),
      [{ instrument: "XAUUSD", direction: "long", pWin: 0.483, filledN: 120 }],
      [
        {
          instrument: "XAUUSD",
          direction: "long",
          meanR: 0.0344,
          nUsed: 90,
          ciLo: -0.0378,
          ciHi: 0.1067,
          statStatus: "descriptive",
        },
      ],
      [
        { instrument: "XAUUSD", direction: "long", netProfit: 500, currency: "USD" },
        { instrument: "XAUUSD", direction: "long", netProfit: -100, currency: "USD" },
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.winPct).toBe(48.3);
    expect(rows[0]!.expectedR).toBe(0.0344);
    expect(rows[0]!.brokerWins).toBe(1);
    expect(rows[0]!.brokerLosses).toBe(1);
    expect(rows[0]!.brokerNet).toBe(400);
    // The win-rate threshold refuses this cohort even though it made money.
    expect(rows[0]!.verdict).toBe("refused_win_rate");
  });

  it("refuses an unmeasured cohort rather than passing it", () => {
    const rows = buildGateEvidence(
      T({ minWinPct: null, minExpectedR: 0.05 }),
      [],
      [],
      [{ instrument: "EURUSD", direction: "short", netProfit: 10, currency: "USD" }],
    );
    expect(rows[0]!.expectedR).toBeNull();
    expect(rows[0]!.verdict).toBe("refused_unmeasured");
  });

  it("refuses a cohort whose whole measured range sits below zero", () => {
    const rows = buildGateEvidence(
      T({ minWinPct: null, minExpectedR: -1 }),
      [],
      [
        {
          instrument: "GBPAUD",
          direction: "short",
          meanR: -0.2,
          nUsed: 80,
          ciLo: -0.4,
          ciHi: -0.05,
          statStatus: "descriptive",
        },
      ],
      [],
    );
    expect(rows[0]!.verdict).toBe("refused_expected_r");
  });

  it("reports gate_off when no threshold is configured", () => {
    const rows = buildGateEvidence(
      T({ enabled: false }),
      [{ instrument: "EURUSD", direction: "long", pWin: 0.6, filledN: 300 }],
      [],
      [],
    );
    expect(rows[0]!.verdict).toBe("gate_off");
  });

  it("refuses to add unlike currencies", () => {
    const rows = buildGateEvidence(
      T({ enabled: false }),
      [],
      [],
      [
        { instrument: "EURUSD", direction: "long", netProfit: 10, currency: "USD" },
        { instrument: "EURUSD", direction: "long", netProfit: 10, currency: "EUR" },
      ],
    );
    expect(rows[0]!.brokerMixedCurrency).toBe(true);
    expect(rows[0]!.brokerNet).toBeNull();
  });

  it("skips payoff rows whose statistics are not reportable", () => {
    const rows = buildGateEvidence(
      T({ minWinPct: null, minExpectedR: 0 }),
      [],
      [
        {
          instrument: "USDJPY",
          direction: "long",
          meanR: 0.9,
          nUsed: 3,
          ciLo: null,
          ciHi: null,
          statStatus: "insufficient",
        },
      ],
      [],
    );
    // An unreportable statistic contributes no cohort at all — it is never
    // rounded up into a usable measurement.
    expect(rows).toHaveLength(0);
  });
});
