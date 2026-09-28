/**
 * User approval of AI proposals. The AI (in-app or an outside MCP client) can
 * only create a pending proposal; the change runs here, only after the signed-in
 * owner taps Approve. Each proposal is single-use and expires after 15 minutes.
 * The executors are the existing platform paths: cancelDeliveryById, the
 * risk-policy upsert and the cohort-policy upsert.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  cancelProposalInput,
  cohortProposalInput,
  riskPolicyProposalInput,
} from "@/lib/ai-tools/bodies";

export interface ProposalView {
  id: string;
  kind: string;
  summary: string;
  status: string;
  source: string;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  result: unknown;
  expired: boolean;
}

const idInput = z.object({ id: z.string().uuid() });

export const getProposal = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data, context }): Promise<ProposalView | null> => {
    const { data: row, error } = await context.supabase
      .from("ai_action_proposals")
      .select("id, kind, summary, status, source, created_at, expires_at, decided_at, result")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    return {
      id: row.id,
      kind: row.kind,
      summary: row.summary,
      status: row.status,
      source: row.source,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      decidedAt: row.decided_at,
      result: row.result,
      expired: row.status === "pending" && new Date(row.expires_at).getTime() < Date.now(),
    };
  });

export const decideProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), decision: z.enum(["approve", "decline"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("ai_action_proposals")
      .select("id, user_id, kind, payload, status, expires_at")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Proposal not found");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const settle = async (status: string, result: unknown) => {
      // Single-use: only a still-pending row can be settled.
      const { data: done, error: e } = await supabaseAdmin
        .from("ai_action_proposals")
        .update({ status, result: result as never, decided_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "pending")
        .select("id");
      if (e) throw new Error(e.message);
      if (!done || done.length === 0) throw new Error("Proposal was already decided");
      return { status, result };
    };

    if (row.status !== "pending") throw new Error(`Proposal is already ${row.status}`);
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return settle("expired", { message: "Expired before approval. Nothing changed." });
    }
    if (data.decision === "decline") {
      return settle("declined", { message: "Declined. Nothing changed." });
    }

    try {
      if (row.kind === "cancel_order") {
        const p = cancelProposalInput.parse(row.payload);
        const { data: d, error: dErr } = await supabaseAdmin
          .from("execution_deliveries")
          .select(
            "id, state, broker_symbol, dry_run, broker_order_id, destination_type, connected_account_id, submitted_at, sent_at, enqueued_at, user_id, client_id, broker_order_state, broker_state_at",
          )
          .eq("id", p.delivery_id)
          .eq("user_id", context.userId)
          .maybeSingle();
        if (dErr) throw new Error(dErr.message);
        if (!d) return settle("failed", { message: "Order not found among your orders." });
        const { cancelDeliveryById } = await import("@/lib/delivery/cancel-delivery.server");
        const r = await cancelDeliveryById(
          supabaseAdmin,
          { ...d, direction: null } as never,
          "cancelled_by_user_via_assistant",
        );
        return settle(r.action === "expired" ? "approved" : "failed", {
          message:
            r.action === "expired"
              ? "Cancelled — the broker confirmed the order is no longer waiting."
              : `Not cancelled: ${r.reason}. The order was left as it is.`,
        });
      }

      if (row.kind === "risk_policy") {
        const p = riskPolicyProposalInput.parse(row.payload);
        const { data: acct } = await context.supabase
          .from("connected_trading_accounts")
          .select("id")
          .eq("id", p.account_id)
          .eq("user_id", context.userId)
          .maybeSingle();
        if (!acct) return settle("failed", { message: "Account not found." });
        const { data: existing } = await supabaseAdmin
          .from("connected_account_risk_policies")
          .select("policy_kind, max_trades_per_day, daily_profit_objective, news_trading_allowed")
          .eq("account_id", p.account_id)
          .maybeSingle();
        const { error: upErr } = await supabaseAdmin
          .from("connected_account_risk_policies")
          .upsert(
            {
              account_id: p.account_id,
              user_id: context.userId,
              policy_kind: existing?.policy_kind ?? "standard",
              starting_balance: p.starting_balance,
              operating_risk_per_trade_percent: p.operating_risk_per_trade_percent,
              hard_risk_per_trade_percent: p.hard_risk_per_trade_percent,
              max_daily_loss_percent: p.max_daily_loss_percent ?? null,
              max_total_loss_percent: p.max_total_loss_percent ?? null,
              trailing_drawdown: p.trailing_drawdown ?? false,
              max_trades_per_day:
                p.max_trades_per_day !== undefined
                  ? p.max_trades_per_day
                  : (existing?.max_trades_per_day ?? null),
              daily_profit_objective: existing?.daily_profit_objective ?? null,
              news_trading_allowed: existing?.news_trading_allowed ?? null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "account_id" },
          );
        if (upErr) return settle("failed", { message: upErr.message });
        return settle("approved", { message: "Risk policy saved." });
      }

      if (row.kind === "cohort_policy") {
        const p = cohortProposalInput.parse(row.payload);
        const { clampCohortRiskShare } = await import("@/lib/delivery/cohort-policy");
        if (p.policy === "allow") {
          const { error: e } = await context.supabase
            .from("auto_cohort_policies")
            .delete()
            .eq("user_id", context.userId)
            .eq("instrument", p.instrument)
            .eq("direction", p.direction);
          if (e) return settle("failed", { message: e.message });
        } else {
          const share =
            p.policy === "reduce" ? clampCohortRiskShare(p.risk_share_percent ?? 50) : 100;
          const { error: e } = await context.supabase.from("auto_cohort_policies").upsert(
            {
              user_id: context.userId,
              instrument: p.instrument,
              direction: p.direction,
              policy: p.policy,
              risk_share_percent: share,
            },
            { onConflict: "user_id,instrument,direction" },
          );
          if (e) return settle("failed", { message: e.message });
        }
        return settle("approved", { message: "Automatic-trading policy saved." });
      }
      return settle("failed", { message: "Unknown proposal type." });
    } catch (e) {
      if (e instanceof Error && e.message === "Proposal was already decided") throw e;
      return settle("failed", { message: e instanceof Error ? e.message : "Failed" });
    }
  });
