/**
 * Account-scoped risk policy.
 *
 * Broker facts (balance/equity/leverage/specs) remain broker-authoritative.
 * These values are operator/prop-program constraints and are evaluated per
 * connected account. A missing policy never grants execution.
 */
export type AccountPolicyKind = "standard" | "equity_edge_instant_50k";

export interface AccountRiskPolicy {
  kind: AccountPolicyKind;
  startingBalance: number;
  /** Normal P-Trades operating risk. Must never exceed hardRiskPerTradePercent. */
  operatingRiskPerTradePercent: number;
  hardRiskPerTradePercent: number;
  maxDailyLossPercent: number | null;
  maxTotalLossPercent: number | null;
  trailingDrawdown: boolean;
  consistencyPercent: number | null;
  safetyBufferPercent: number | null;
  minTradingDays: number | null;
  maxTradesPerDay: number | null;
  newsTradingAllowed: boolean | null;
}

export const EQUITY_EDGE_INSTANT_50K: Readonly<AccountRiskPolicy> = Object.freeze({
  kind: "equity_edge_instant_50k",
  startingBalance: 50_000,
  // Conservative P-Trades operating default; the firm's 1% remains the hard ceiling.
  operatingRiskPerTradePercent: 0.25,
  hardRiskPerTradePercent: 1,
  maxDailyLossPercent: 3,
  maxTotalLossPercent: 5,
  trailingDrawdown: true,
  consistencyPercent: 15,
  safetyBufferPercent: 3,
  minTradingDays: 7,
  maxTradesPerDay: 2,
  newsTradingAllowed: false,
});

export interface AccountPolicyState {
  equity: number | null;
  balance: number | null;
  /** Highest broker-confirmed balance/equity basis used by the account program. */
  trailingHighWatermark: number | null;
  todayNetPnl: number | null;
  totalNetProfit: number | null;
  largestWinningDay: number | null;
  tradingDays: number | null;
  tradesToday: number | null;
}

export interface AccountPolicyVerdict {
  status: "allow" | "warning" | "block";
  reasons: string[];
  riskPercent: number | null;
  riskAmount: number | null;
  dailyLossRemaining: number | null;
  totalLossRemaining: number | null;
  consistencyScore: number | null;
  safetyBufferRemaining: number | null;
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

export function evaluateAccountPolicy(
  policy: AccountRiskPolicy | null,
  state: AccountPolicyState,
): AccountPolicyVerdict {
  if (!policy) {
    return {
      status: "block",
      reasons: ["account_policy_missing"],
      riskPercent: null,
      riskAmount: null,
      dailyLossRemaining: null,
      totalLossRemaining: null,
      consistencyScore: null,
      safetyBufferRemaining: null,
    };
  }

  const reasons: string[] = [];
  if (!finite(state.equity) || state.equity <= 0 || !finite(state.balance) || state.balance <= 0) {
    return {
      status: "block",
      reasons: ["broker_equity_or_balance_unavailable"],
      riskPercent: null,
      riskAmount: null,
      dailyLossRemaining: null,
      totalLossRemaining: null,
      consistencyScore: null,
      safetyBufferRemaining: null,
    };
  }

  const riskPercent = Math.min(policy.operatingRiskPerTradePercent, policy.hardRiskPerTradePercent);
  const riskAmount = state.equity * (riskPercent / 100);

  const dailyLimit =
    policy.maxDailyLossPercent === null
      ? null
      : policy.startingBalance * (policy.maxDailyLossPercent / 100);
  let dailyLossRemaining: number | null = null;
  if (dailyLimit !== null) {
    if (!finite(state.todayNetPnl)) {
      reasons.push("daily_loss_state_unavailable");
    } else {
      const dailyLossUsed = state.todayNetPnl < 0 ? Math.abs(state.todayNetPnl) : 0;
      dailyLossRemaining = Math.max(0, dailyLimit - dailyLossUsed);
      if (dailyLossRemaining <= riskAmount) reasons.push("daily_loss_budget_exhausted");
    }
  }

  let totalLossRemaining: number | null = null;
  if (policy.maxTotalLossPercent !== null) {
    const distance = policy.startingBalance * (policy.maxTotalLossPercent / 100);
    const high = policy.trailingDrawdown ? state.trailingHighWatermark : policy.startingBalance;
    if (!finite(high)) reasons.push("trailing_high_watermark_unavailable");
    else {
      const floor = high - distance;
      totalLossRemaining = Math.max(0, state.equity - floor);
      if (totalLossRemaining <= riskAmount) reasons.push("total_loss_budget_exhausted");
    }
  }

  const consistencyScore =
    policy.consistencyPercent !== null &&
    finite(state.totalNetProfit) &&
    state.totalNetProfit > 0 &&
    finite(state.largestWinningDay)
      ? (state.largestWinningDay / state.totalNetProfit) * 100
      : null;

  if (
    policy.consistencyPercent !== null &&
    consistencyScore !== null &&
    consistencyScore > policy.consistencyPercent
  ) {
    // Consistency is a payout-eligibility constraint, not an invented broker stop.
    reasons.push("consistency_above_payout_threshold");
  }

  const safetyBuffer =
    policy.safetyBufferPercent === null
      ? null
      : policy.startingBalance * (policy.safetyBufferPercent / 100);
  const profit = state.balance - policy.startingBalance;
  const safetyBufferRemaining =
    safetyBuffer === null ? null : Math.max(0, safetyBuffer - Math.max(0, profit));

  if (policy.maxTradesPerDay !== null) {
    if (!finite(state.tradesToday)) reasons.push("daily_trade_count_unavailable");
    else if (state.tradesToday >= policy.maxTradesPerDay) {
      reasons.push("p_trades_daily_trade_limit_reached");
    }
  }

  if (
    policy.minTradingDays !== null &&
    finite(state.tradingDays) &&
    state.tradingDays < policy.minTradingDays
  ) {
    reasons.push("minimum_trading_days_not_met_for_payout");
  }

  const hardBlocks = new Set([
    "daily_loss_budget_exhausted",
    "daily_loss_state_unavailable",
    "total_loss_budget_exhausted",
    "trailing_high_watermark_unavailable",
    "p_trades_daily_trade_limit_reached",
    "daily_trade_count_unavailable",
  ]);
  const status = reasons.some((reason) => hardBlocks.has(reason))
    ? "block"
    : reasons.length > 0
      ? "warning"
      : "allow";

  return {
    status,
    reasons,
    riskPercent,
    riskAmount,
    dailyLossRemaining,
    totalLossRemaining,
    consistencyScore,
    safetyBufferRemaining,
  };
}
