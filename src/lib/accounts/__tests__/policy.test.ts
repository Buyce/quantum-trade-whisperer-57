import { describe, expect, it } from "vitest";
import { EQUITY_EDGE_INSTANT_50K, evaluateAccountPolicy, type AccountPolicyState } from "../policy";

const healthy: AccountPolicyState = {
  equity: 52_000,
  balance: 52_000,
  trailingHighWatermark: 52_000,
  todayNetPnl: 0,
  totalNetProfit: 2_000,
  largestWinningDay: 250,
  tradingDays: 8,
  tradesToday: 0,
};

describe("account-scoped risk policy", () => {
  it("[INVARIANT] fails closed when no account policy exists", () => {
    expect(evaluateAccountPolicy(null, healthy).status).toBe("block");
  });

  it("[INVARIANT] sizes operating risk below the firm's hard ceiling", () => {
    const v = evaluateAccountPolicy(EQUITY_EDGE_INSTANT_50K, healthy);
    expect(v.riskPercent).toBe(0.25);
    expect(v.riskAmount).toBe(130);
    expect(v.riskAmount).toBeLessThan(healthy.equity! * 0.01);
  });

  it("[INVARIANT] blocks an account independently when its daily budget is exhausted", () => {
    const v = evaluateAccountPolicy(EQUITY_EDGE_INSTANT_50K, {
      ...healthy,
      todayNetPnl: -1_450,
    });
    expect(v.status).toBe("block");
    expect(v.reasons).toContain("daily_loss_budget_exhausted");
  });

  it("[INVARIANT] fails closed when a trailing account has no high-water mark", () => {
    const v = evaluateAccountPolicy(EQUITY_EDGE_INSTANT_50K, {
      ...healthy,
      trailingHighWatermark: null,
    });
    expect(v.status).toBe("block");
    expect(v.reasons).toContain("trailing_high_watermark_unavailable");
  });

  it("[UNIT] treats consistency as payout eligibility rather than an execution block", () => {
    const v = evaluateAccountPolicy(EQUITY_EDGE_INSTANT_50K, {
      ...healthy,
      largestWinningDay: 500,
    });
    expect(v.status).toBe("warning");
    expect(v.reasons).toContain("consistency_above_payout_threshold");
  });

  it("[INVARIANT] blocks when daily loss state is unavailable", () => {
    const v = evaluateAccountPolicy(EQUITY_EDGE_INSTANT_50K, {
      ...healthy,
      todayNetPnl: null,
    });
    expect(v.status).toBe("block");
    expect(v.reasons).toContain("daily_loss_state_unavailable");
  });

  it("[INVARIANT] blocks when today's trade count is unavailable", () => {
    const v = evaluateAccountPolicy(EQUITY_EDGE_INSTANT_50K, {
      ...healthy,
      tradesToday: null,
    });
    expect(v.status).toBe("block");
    expect(v.reasons).toContain("daily_trade_count_unavailable");
  });

  it("[INVARIANT] enforces the P-Trades per-account trade cap", () => {
    const v = evaluateAccountPolicy(EQUITY_EDGE_INSTANT_50K, {
      ...healthy,
      tradesToday: 2,
    });
    expect(v.status).toBe("block");
    expect(v.reasons).toContain("p_trades_daily_trade_limit_reached");
  });
  it("[INVARIANT] closes P-Trades after the $200 daily objective without forcing trades before it", () => {
    const below = evaluateAccountPolicy(EQUITY_EDGE_INSTANT_50K, {\n      ...healthy,\n      todayNetPnl: 199.99,\n    });
    expect(below.reasons).not.toContain("p_trades_daily_profit_objective_reached");

    const reached = evaluateAccountPolicy(EQUITY_EDGE_INSTANT_50K, {\n      ...healthy,\n      todayNetPnl: 200,\n    });
    expect(reached.status).toBe("block");
    expect(reached.reasons).toContain("p_trades_daily_profit_objective_reached");
  });
  it("[INVARIANT] exposes remaining daily headroom and the 15% consistency denominator", () => {
    const v = evaluateAccountPolicy(EQUITY_EDGE_INSTANT_50K, {
      ...healthy,
      todayNetPnl: 170,
      totalNetProfit: 1_200,
      largestWinningDay: 180,
    });
    expect(v.dailyProfitRemaining).toBe(30);
    expect(v.requiredTotalProfitForConsistency).toBeCloseTo(1_333.333333, 5);
  });
});
