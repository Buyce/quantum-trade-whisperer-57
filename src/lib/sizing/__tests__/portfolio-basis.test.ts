/**
 * Prompt 12 closure — defect B: the advisory keeps Prompt-9 R-basis isolation.
 *
 * The planned-risk daily-loss series is built from canonical `r_vs_plan` only.
 * Frozen legacy R is a different unit of account and must never move the total.
 */
import { describe, expect, it } from "vitest";
import { portfolioAdvisory, type AdvisoryTradeRow } from "../portfolio";
import type { RiskProfile } from "@/lib/risk";

const profile: RiskProfile = {
  accountEquity: 10_000,
  accountCurrency: "USD",
  riskPerTradePercent: 1,
  maxPositionSize: 100,
  leverage: 100,
  maxStopLossPercent: 5,
};

const NOW = new Date("2026-08-23T12:00:00.000Z");
const closedToday = "2026-08-23T09:00:00.000Z";

describe("portfolio advisory R basis", () => {
  it("[UNIT] sums canonical planned-risk losses closed today", () => {
    const rows: AdvisoryTradeRow[] = [
      { outcome: "loss", actual_exit_at: closedToday, r_vs_plan: -1.5 },
      { outcome: "win", actual_exit_at: closedToday, r_vs_plan: 2 },
    ];
    expect(portfolioAdvisory(rows, profile, NOW).realizedLossTodayR).toBe(1.5);
  });

  it("[INVARIANT] a legacy-only loss cannot alter the canonical daily loss", () => {
    const legacyOnly = [
      {
        outcome: "loss",
        actual_exit_at: closedToday,
        r_vs_plan: null,
        // Frozen legacy provenance, deliberately large.
        derived_r: -9,
        realized_r_multiple: -9,
      },
    ] as unknown as AdvisoryTradeRow[];
    const advisory = portfolioAdvisory(legacyOnly, profile, NOW);
    expect(advisory.realizedLossTodayR).toBe(0);
    expect(advisory.realizedLossTodayMoney).toBe(0);
  });
});
