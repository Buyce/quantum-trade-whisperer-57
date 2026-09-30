import { describe, expect, it } from "vitest";

import { mayInfluenceExecution, TRADING_CAPABILITIES } from "../capabilities";
import { flightRecord } from "../flight-recorder";
import { runDigitalTwin } from "../digital-twin";
import { evaluateAccounts } from "../multi-account";
import { evaluateProjectedPropRisk } from "../prop-projection";
import type { AccountRiskPolicy } from "@/lib/accounts/policy";
import type { DecisionGate, TradingDecision } from "@/lib/trading-kernel";

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
    expect(Object.isFrozen(TRADING_CAPABILITIES)).toBe(true);
    expect(Object.isFrozen(TRADING_CAPABILITIES.digital_twin)).toBe(true);
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

  it("[INVARIANT] blocks a trade that would consume the final hard-loss allowance", () => {
    const verdict = evaluateProjectedPropRisk(
      policy,
      {
        equity: 47_600,
        balance: 47_600,
        trailingHighWatermark: 50_000,
        todayNetPnl: -1_400,
        totalNetProfit: null,
        largestWinningDay: null,
        tradingDays: null,
        tradesToday: null,
      },
      { riskAmount: 100, volume: 0.2, maxLots: 2 },
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.projectedDailyLossRemaining).toBe(0);
    expect(verdict.projectedTotalLossRemaining).toBe(0);
    expect(verdict.blockers).toContain("projected_daily_loss_breach");
    expect(verdict.blockers).toContain("projected_total_loss_breach");
  });

  it("[INVARIANT] flight records do not share mutable decision evidence", () => {
    const gate = pass("strategy");
    const decision: TradingDecision = {
      version: 1,
      verdict: "eligible",
      vetoLayer: null,
      blockers: [],
      gates: [gate],
      executionEligible: true,
      reason: "all gates passed",
    };
    const record = flightRecord({
      version: 1,
      decisionId: "d-1",
      observedAt: "2026-09-30T00:00:00Z",
      instrument: "XAUUSD",
      direction: "short",
      grade: "A",
      accountId: "a",
      brokerProvider: "metaapi",
      quoteObservedAt: "2026-09-30T00:00:00Z",
      regime: "trend",
      session: "london",
      newsState: "clear",
      decision,
      modelVersions: { scanner: 2 },
    });
    gate.reason = "mutated later";
    decision.gates.push(pass("risk"));
    expect(record.decision.gates).toHaveLength(1);
    expect(record.decision.gates[0]?.reason).toBe("ok");
    expect(Object.isFrozen(record.decision.gates[0])).toBe(true);
    expect(Object.isFrozen(record.decision.gates)).toBe(true);
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
