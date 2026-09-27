import { describe, expect, it } from "vitest";
import { buildQCoreWeeklyResearchReport } from "../weekly-report";

const input = {
  direction: "long" as const,
  trend: 80,
  orderBlock: 75,
  momentum: 70,
  volatilityExpansion: 65,
  rr: 2,
  maxR: 2.5,
  regimeWinRate: null,
  regimeActive: false,
  executionQuality: null,
};

describe("Q-Core weekly research report", () => {
  it("[UNIT] limits weekly metrics to the requested window", () => {
    const rows = [
      {
        id: "old",
        detectedAt: "2026-09-10T12:00:00Z",
        instrument: "XAUUSD",
        input,
        realizedR: 9,
        filled: true,
      },
      {
        id: "week",
        detectedAt: "2026-09-25T12:00:00Z",
        instrument: "XAUUSD",
        input,
        realizedR: 2,
        filled: true,
      },
    ];
    const report = buildQCoreWeeklyResearchReport(
      rows,
      "2026-09-21T00:00:00Z",
      "2026-09-27T23:59:59Z",
    );
    expect(report.observations).toBe(1);
    expect(report.cumulativeR).toBe(2);
    expect(report.policyId).toMatch(/^qcore_/);
  });
});
