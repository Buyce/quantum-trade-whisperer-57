/**
 * Server-side account-policy adapter for execution.
 *
 * This module never grants execution. It reads exactly one connected account's
 * policy and derives the maximum risk percentage that downstream sizing may use.
 * Missing/unreadable state fails closed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateAccountPolicy, type AccountRiskPolicy } from "./policy";
import { fetchDeals } from "@/lib/metaapi/history.server";

type Db = Pick<SupabaseClient, "from">;

export type AccountExecutionPolicyResult =
  | {
      ok: true;
      riskPercent: number;
      status: "allow" | "warning";
      reasons: string[];
      newsTradingAllowed: boolean | null;
    }
  | { ok: false; reason: "account_risk_policy"; detail: string };

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function accountExecutionPolicy(
  db: Db,
  input: {
    accountId: string;
    userId: string;
    equity: number | null;
    balance: number | null;
    now?: number;
    /** Delivery currently being evaluated; never counts against its own daily cap. */
    excludeDeliveryId?: number;
  },
): Promise<AccountExecutionPolicyResult> {
  const { data: policyRow, error: policyError } = await db
    .from("connected_account_risk_policies")
    .select(
      "policy_kind, starting_balance, operating_risk_per_trade_percent, hard_risk_per_trade_percent, max_daily_loss_percent, max_total_loss_percent, trailing_drawdown, consistency_percent, safety_buffer_percent, min_trading_days, max_trades_per_day, news_trading_allowed, high_watermark",
    )
    .eq("account_id", input.accountId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (policyError || !policyRow) {
    return {
      ok: false,
      reason: "account_risk_policy",
      detail: policyError
        ? "account risk policy unreadable"
        : "account risk policy is not configured",
    };
  }

  const row = policyRow as Record<string, unknown>;
  const policy: AccountRiskPolicy = {
    kind: row["policy_kind"] === "equity_edge_instant_50k" ? "equity_edge_instant_50k" : "standard",
    startingBalance: num(row["starting_balance"]) ?? 0,
    operatingRiskPerTradePercent: num(row["operating_risk_per_trade_percent"]) ?? 0,
    hardRiskPerTradePercent: num(row["hard_risk_per_trade_percent"]) ?? 0,
    maxDailyLossPercent: num(row["max_daily_loss_percent"]),
    maxTotalLossPercent: num(row["max_total_loss_percent"]),
    trailingDrawdown: row["trailing_drawdown"] === true,
    consistencyPercent: num(row["consistency_percent"]),
    safetyBufferPercent: num(row["safety_buffer_percent"]),
    minTradingDays: num(row["min_trading_days"]),
    maxTradesPerDay: num(row["max_trades_per_day"]),
    newsTradingAllowed:
      typeof row["news_trading_allowed"] === "boolean"
        ? (row["news_trading_allowed"] as boolean)
        : null,
  };

  if (
    !(policy.startingBalance > 0) ||
    !(policy.operatingRiskPerTradePercent > 0) ||
    !(policy.hardRiskPerTradePercent > 0) ||
    policy.operatingRiskPerTradePercent > policy.hardRiskPerTradePercent
  ) {
    return { ok: false, reason: "account_risk_policy", detail: "account risk policy is invalid" };
  }

  const now = input.now ?? Date.now();
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);

  // Hard daily-loss policy must see the WHOLE broker account, including manual
  // trades. P-Trades evidence intentionally contains only positively-associated
  // P-Trades orders, so it is not authoritative for a prop-account daily limit.
  const { data: accountRow, error: accountError } = await db
    .from("connected_trading_accounts")
    .select("metaapi_account_id, region")
    .eq("id", input.accountId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (accountError || !accountRow) {
    return { ok: false, reason: "account_risk_policy", detail: "broker account identity unreadable" };
  }
  const brokerAccount = accountRow as { metaapi_account_id: string | null; region: string | null };
  if (!brokerAccount.metaapi_account_id || !brokerAccount.region) {
    return { ok: false, reason: "account_risk_policy", detail: "broker account identity incomplete" };
  }

  let todayDeals;
  try {
    todayDeals = await fetchDeals(
      brokerAccount.metaapi_account_id,
      brokerAccount.region,
      dayStart,
      new Date(now),
    );
  } catch {
    return { ok: false, reason: "account_risk_policy", detail: "account-wide broker history unreadable" };
  }
  let todayNetPnl = 0;
  for (const deal of todayDeals) {
    // Missing money fields are unknown, never zero. A hard daily-loss limit must
    // not authorize from a partial broker outcome.
    if (
      typeof deal.profit !== "number" ||
      !Number.isFinite(deal.profit) ||
      typeof deal.commission !== "number" ||
      !Number.isFinite(deal.commission) ||
      typeof deal.swap !== "number" ||
      !Number.isFinite(deal.swap)
    ) {
      return {
        ok: false,
        reason: "account_risk_policy",
        detail: "account-wide broker history contains incomplete money fields",
      };
    }
    todayNetPnl += deal.profit + deal.commission + deal.swap;
  }

  // Only broker-confirmed closed outcomes and this account's delivery ledger are
  // allowed to influence the policy. Unknown metrics remain null and fail closed
  // where they are required by a hard limit.
  const [closed, deliveries, riskState] = await Promise.all([
    db
      .from("broker_trade_evidence")
      .select("exit_at, gross_profit, commission, swap")
      .eq("account_id", input.accountId)
      .eq("state", "closed")
      .not("exit_at", "is", null)
      .order("exit_at", { ascending: false })
      .limit(5000),
    db
      .from("execution_deliveries")
      .select("id, enqueued_at, state")
      .eq("connected_account_id", input.accountId)
      .eq("user_id", input.userId)
      .in("state", ["claimed", "sent", "acknowledged", "unknown"])
      .gte("enqueued_at", dayStart.toISOString())
      .limit(500),
    db
      .from("account_risk_state")
      .select("peak_equity")
      .eq("account_id", input.accountId)
      .maybeSingle(),
  ]);

  if (closed.error || deliveries.error || riskState.error) {
    return {
      ok: false,
      reason: "account_risk_policy",
      detail: "account policy metrics unreadable",
    };
  }

  const byDay = new Map<string, number>();
  for (const raw of closed.data ?? []) {
    const r = raw as {
      exit_at: string | null;
      gross_profit: number | string | null;
      commission: number | string | null;
      swap: number | string | null;
    };
    if (!r.exit_at) continue;
    const gross = num(r.gross_profit);
    const commission = num(r.commission);
    const swap = num(r.swap);
    if (gross === null || commission === null || swap === null) {
      return {
        ok: false,
        reason: "account_risk_policy",
        detail: "stored broker outcome contains incomplete money fields",
      };
    }
    const profit = gross + commission + swap;
    const day = r.exit_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + profit);
  }
  const dailyPnls = [...byDay.values()];
  const totalNetProfit = dailyPnls.length ? dailyPnls.reduce((a, b) => a + b, 0) : 0;
  const largestWinningDay = dailyPnls.filter((x) => x > 0).reduce((a, b) => Math.max(a, b), 0);

  const verdict = evaluateAccountPolicy(policy, {
    equity: input.equity,
    balance: input.balance,
    trailingHighWatermark: Math.max(
      num(row["high_watermark"]) ?? 0,
      num((riskState.data as { peak_equity?: unknown } | null)?.peak_equity) ?? 0,
      input.equity ?? 0,
    ),
    todayNetPnl,
    totalNetProfit,
    largestWinningDay,
    tradingDays: byDay.size,
    tradesToday: (deliveries.data ?? []).filter(
      (row) => (row as { id: number }).id !== input.excludeDeliveryId,
    ).length,
  });

  if (verdict.status === "block" || verdict.riskPercent === null) {
    return {
      ok: false,
      reason: "account_risk_policy",
      detail: verdict.reasons.join(", ") || "account policy refused execution",
    };
  }

  return {
    ok: true,
    riskPercent: verdict.riskPercent,
    status: verdict.status,
    reasons: verdict.reasons,
    newsTradingAllowed: policy.newsTradingAllowed,
  };
}
