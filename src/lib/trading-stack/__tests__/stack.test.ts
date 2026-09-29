import { describe, expect, it } from "vitest";

import { mayInfluenceExecution } from "../capabilities";
import { runDigitalTwin } from "../digital-twin";
import { evaluateAccounts } from "../multi-account";
import { evaluateProjectedPropRisk } from "../prop-projection";
import type { AccountRiskPolicy } from "@/lib/accounts/policy";
import type { DecisionGate } from "@/lib/trading-kernel";

const pass = (layer: "strategy" | "risk" | "execution"): DecisionGate => ({
  id: `${layer}_ok`,
  layer,
  state: "pass",
  reason: "ok",
});

const policy: AccountRiskPolicy = {
  kind: "standard",
  startingBalance: 50_000,
  operatingRiskPerTradePercent: 0.25,
  hardRiskPerTradePercent: 1,
  maxDailyLossPercent: 3,
  maxTotalLossPercent: 5,
  trailingDrawdown: true,
  consistencyPercent: 15,
  safetyBufferPercent: 3,
  minTradingDays: 7,
  maxTradesPerDay: 2,
  dailyProfitObjective: null,
  newsTradingAllowed: false,
};

describe("trading stack v2", () => {
  it("[INVARIANT] shadow and unavailable capabilities cannot influence execution", () => {
    expect(mayInfluenceExecution("exchange_microstructure")).toBe(false);
    expect(mayInfluenceExecution("digital_twin")).toBe(false);
    expect(mayInfluenceExecution("direct_mt5_execution")).toBe(false);
    expect(mayInfluenceExecution("strategy_kernel")).toBe(true);
  });

  it("[INVARIANT] projected prop risk blocks a trade that would cross the hard daily loss", () => {
    const verdict = evaluateProjectedPropRisk(
      policy,
      {
        equity: 49_000,
        balance: 49_000,
        trailingHighWatermark: 50_000,
        todayNetPnl: -1_450,
        totalNetProfit: null,
        largestWinningDay: null,
        tradingDays: null,
        tradesToday: null,
      },
      { riskAmount: 100, volume: 0.2, maxLots: 2 },
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.blockers).toContain("projected_daily_loss_breach");
  });

  it("[INVARIANT] each account needs its own valid volume", () => {
    const common = {
      instrument: "XAUUSD",
      direction: "short" as const,
      grade: "A",
      strategy: [pass("strategy")],
      risk: [pass("risk")],
      execution: [pass("execution")],
    };
    const result = evaluateAccounts([
      { ...common, accountId: "a", volume: 0.2 },
      { ...common, accountId: "b", volume: null },
    ]);
    expect(result[0]?.eligible).toBe(true);
    expect(result[1]?.eligible).toBe(false);
  });

  it("[INVARIANT] digital twin subtracts explicit costs and stays shadow-only", () => {
    const result = runDigitalTwin([
      { grossR: 2, spreadR: 0.05, slippageR: 0.05, commissionR: 0.05, rejected: false },
      { grossR: -1, spreadR: 0.05, slippageR: 0, commissionR: 0.05, rejected: false },
      { grossR: 3, spreadR: 0, slippageR: 0, commissionR: 0, rejected: true },
    ]);
    expect(result.executionEligible).toBe(false);
    expect(result.resolved).toBe(2);
    expect(result.rejected).toBe(1);
    expect(result.cumulativeNetR).toBeCloseTo(0.75);
  });
});
