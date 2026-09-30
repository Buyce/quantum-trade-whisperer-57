import type { AccountRiskPolicy, AccountPolicyState } from "@/lib/accounts/policy";

export interface ProposedTradeRisk {
  riskAmount: number | null;
  volume: number | null;
  maxLots: number | null;
}

export interface ProjectedPropVerdict {
  allowed: boolean;
  blockers: string[];
  projectedDailyLossRemaining: number | null;
  projectedTotalLossRemaining: number | null;
}

/**
 * Final projected-state guard for a proposed order.
 *
 * Existing account policy determines the operating risk percentage. This guard
 * asks the separate question: "if the full initial risk is lost, does the
 * account remain inside its hard daily/total-loss boundary?"
 *
 * Missing facts needed by an enabled hard rule fail closed.
 */
export function evaluateProjectedPropRisk(
  policy: AccountRiskPolicy | null,
  state: AccountPolicyState,
  proposed: ProposedTradeRisk,
): ProjectedPropVerdict {
  const blockers: string[] = [];
  if (!policy) {
    return {
      allowed: false,
      blockers: ["account_policy_missing"],
      projectedDailyLossRemaining: null,
      projectedTotalLossRemaining: null,
    };
  }
  const risk = proposed.riskAmount;
  if (risk === null || !Number.isFinite(risk) || risk <= 0) {
    return {
      allowed: false,
      blockers: ["proposed_risk_unavailable"],
      projectedDailyLossRemaining: null,
      projectedTotalLossRemaining: null,
    };
  }
  if (
    proposed.maxLots !== null &&
    (proposed.volume === null ||
      !Number.isFinite(proposed.volume) ||
      proposed.volume <= 0 ||
      proposed.volume > proposed.maxLots)
  ) {
    blockers.push("proposed_volume_exceeds_account_limit");
  }

  let projectedDailyLossRemaining: number | null = null;
  if (policy.maxDailyLossPercent !== null) {
    if (state.todayNetPnl === null || !Number.isFinite(state.todayNetPnl)) {
      blockers.push("daily_loss_state_unavailable");
    } else {
      const limit = policy.startingBalance * (policy.maxDailyLossPercent / 100);
      const used = Math.max(0, -state.todayNetPnl);
      projectedDailyLossRemaining = limit - used - risk;
      if (projectedDailyLossRemaining <= 0) blockers.push("projected_daily_loss_breach");
    }
  }

  let projectedTotalLossRemaining: number | null = null;
  if (policy.maxTotalLossPercent !== null) {
    if (
      state.equity === null ||
      !Number.isFinite(state.equity) ||
      (policy.trailingDrawdown &&
        (state.trailingHighWatermark === null || !Number.isFinite(state.trailingHighWatermark)))
    ) {
      blockers.push("total_loss_state_unavailable");
    } else {
      const basis = policy.trailingDrawdown
        ? (state.trailingHighWatermark as number)
        : policy.startingBalance;
      const floor = basis - policy.startingBalance * (policy.maxTotalLossPercent / 100);
      projectedTotalLossRemaining = state.equity - risk - floor;
      if (projectedTotalLossRemaining <= 0) blockers.push("projected_total_loss_breach");
    }
  }

  return {
    allowed: blockers.length === 0,
    blockers,
    projectedDailyLossRemaining,
    projectedTotalLossRemaining,
  };
}
