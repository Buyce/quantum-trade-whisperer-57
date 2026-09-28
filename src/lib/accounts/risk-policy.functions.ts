/**
 * Trader-owned account risk policy setup.
 *
 * Authenticated clients cannot write the policy table directly (RLS revokes
 * writes), so this validated server function is the only write path. Ownership
 * comes from the verified token; the high-water mark stays server-managed.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const pct = (max: number) => z.number().gt(0).max(max).nullable();

export const riskPolicyInput = z
  .object({
    accountId: z.string().uuid(),
    kind: z.enum(["standard", "equity_edge_instant_50k"]),
    startingBalance: z.number().gt(0).max(100_000_000),
    operatingRiskPerTradePercent: z.number().gt(0).max(5),
    hardRiskPerTradePercent: z.number().gt(0).max(10),
    maxDailyLossPercent: pct(100),
    maxTotalLossPercent: pct(100),
    trailingDrawdown: z.boolean(),
    maxTradesPerDay: z.number().int().min(1).max(50).nullable(),
    dailyProfitObjective: z.number().gt(0).max(100_000_000).nullable(),
    newsTradingAllowed: z.boolean().nullable(),
  })
  .refine((v) => v.operatingRiskPerTradePercent <= v.hardRiskPerTradePercent, {
    message: "Normal risk per trade cannot be above the hard cap",
  });

export type RiskPolicyInput = z.infer<typeof riskPolicyInput>;

export const saveAccountRiskPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => riskPolicyInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: acct, error } = await context.supabase
      .from("connected_trading_accounts")
      .select("id")
      .eq("id", data.accountId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!acct) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: upErr } = await supabaseAdmin.from("connected_account_risk_policies").upsert(
      {
        account_id: data.accountId,
        user_id: context.userId,
        policy_kind: data.kind,
        starting_balance: data.startingBalance,
        operating_risk_per_trade_percent: data.operatingRiskPerTradePercent,
        hard_risk_per_trade_percent: data.hardRiskPerTradePercent,
        max_daily_loss_percent: data.maxDailyLossPercent,
        max_total_loss_percent: data.maxTotalLossPercent,
        trailing_drawdown: data.trailingDrawdown,
        max_trades_per_day: data.maxTradesPerDay,
        daily_profit_objective: data.dailyProfitObjective,
        news_trading_allowed: data.newsTradingAllowed,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "account_id" },
    );
    if (upErr) throw new Error(upErr.message);
    return { ok: true };
  });
