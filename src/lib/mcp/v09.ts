/**
 * v0.9 MCP tools: extra reads, the dry-run Runtime Validation check and the
 * approval-gated proposals. Bodies live in src/lib/ai-tools/bodies.ts and are
 * shared with the in-app assistant.
 */
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "./supabase";
import {
  envelope,
  runGetCohortPolicies,
  runGetRiskPolicy,
  runListNewsBlackouts,
  runListRestingOrders,
  runListReviewItems,
  runProposeCancelOrder,
  runProposeCohortPolicy,
  runProposeRiskPolicy,
} from "@/lib/ai-tools/bodies";

const unauth = { content: [{ type: "text" as const, text: "Not authenticated" }], isError: true };
const ro = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
const propose = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

function withUser<T>(
  ctx: ToolContext,
  fn: (db: ReturnType<typeof supabaseForUser>, userId: string) => Promise<T>,
) {
  if (!ctx.isAuthenticated()) return Promise.resolve(unauth as unknown as T);
  return fn(supabaseForUser(ctx), ctx.getUserId() as string);
}

export const getRiskPolicy = defineTool({
  name: "get_risk_policy",
  title: "Get my account risk policies",
  description:
    "Each of the user's connected accounts with its risk policy (normal and hard-cap risk per trade, daily/total loss limits, trades per day). policy null = Not set, which keeps automatic orders blocked on that account.",
  inputSchema: { account_id: z.string().uuid().optional() },
  annotations: ro,
  handler: async (input, ctx) =>
    withUser(ctx, (db, uid) => runGetRiskPolicy(db, uid, input as { account_id?: string })),
});

export const listReviewItems = defineTool({
  name: "list_review_items",
  title: "List reconciliation items to review",
  description:
    "Mismatches the scheduled reconciliation found between the broker and P-Trades records (missing orders, untracked positions, balance drift). Nothing is corrected automatically.",
  inputSchema: { include_resolved: z.boolean().optional() },
  annotations: ro,
  handler: async (input, ctx) =>
    withUser(ctx, (db, uid) =>
      runListReviewItems(db, uid, input as { include_resolved?: boolean }),
    ),
});

export const listRestingOrders = defineTool({
  name: "list_resting_orders",
  title: "List my waiting orders",
  description:
    "The user's unfilled orders that P-Trades placed and that are still waiting at the broker. Waiting is not filled.",
  inputSchema: {},
  annotations: ro,
  handler: async (_i, ctx) => withUser(ctx, (db, uid) => runListRestingOrders(db, uid)),
});

export const getCohortPolicies = defineTool({
  name: "get_cohort_policies",
  title: "Get my automatic-trading rules",
  description:
    "The user's per instrument and direction automatic-trading rules (allow, reduce to 25/50/75% risk, block). Unlisted = allow.",
  inputSchema: {},
  annotations: ro,
  handler: async (_i, ctx) => withUser(ctx, (db, uid) => runGetCohortPolicies(db, uid)),
});

export const listNewsBlackouts = defineTool({
  name: "list_news_blackouts",
  title: "List upcoming high-impact news",
  description:
    "Upcoming high-impact economic events from the ingested calendar (default next 48h, max 168h), optionally for one instrument.",
  inputSchema: { hours: z.number().int().optional(), instrument: z.string().optional() },
  annotations: ro,
  handler: async (input, ctx) =>
    withUser(ctx, (db) =>
      runListNewsBlackouts(db, input as { hours?: number; instrument?: string }),
    ),
});

export const runRuntimeValidationTool = defineTool({
  name: "run_runtime_validation",
  title: "Run a Runtime Validation (dry run)",
  description:
    "Runs the nine-check Runtime Validation on one of the user's own accounts: connection, fresh broker facts, permissions, risk policy, symbol mapping, quote and spec, sizing, margin and reconciliation. Strictly non-trading — it never calls /trade, never arms and never edits. The first failing check names the exact reason.",
  inputSchema: {
    account_id: z.string().uuid(),
    symbol: z.string().min(3).max(20),
    direction: z.enum(["long", "short"]),
    stop_distance: z.number().positive().describe("Stop distance in price units, e.g. 0.0020."),
  },
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true },
  handler: async (input, ctx) =>
    withUser(ctx, async (db, uid) => {
      const i = input as {
        account_id: string;
        symbol: string;
        direction: "long" | "short";
        stop_distance: number;
      };
      const { data } = await db
        .from("connected_trading_accounts")
        .select("id")
        .eq("id", i.account_id)
        .eq("user_id", uid)
        .maybeSingle();
      if (!data) return envelope({ error: "Account not found among your accounts." }, true);
      const { runRuntimeValidation } = await import("@/lib/validation/runtime.server");
      const report = await runRuntimeValidation(db as never, {
        accountId: i.account_id,
        symbol: i.symbol,
        direction: i.direction,
        stopDistance: i.stop_distance,
      });
      return envelope(report);
    }),
});

export const proposeCancelOrder = defineTool({
  name: "propose_cancel_order",
  title: "Propose cancelling a waiting order",
  description:
    "Creates a pending cancel proposal for one of the user's own WAITING orders (from list_resting_orders). Nothing is cancelled until the user opens approve_url and taps Approve within 15 minutes. Cannot place, change or close anything.",
  inputSchema: { delivery_id: z.number().int(), reason: z.string().optional() },
  annotations: propose,
  handler: async (input, ctx) =>
    withUser(ctx, (db, uid) => runProposeCancelOrder(db, uid, input, "mcp")),
});

export const proposeRiskPolicy = defineTool({
  name: "propose_risk_policy",
  title: "Propose an account risk policy",
  description:
    "Creates a pending risk-policy proposal for one of the user's accounts. Saved only after the user approves at approve_url.",
  inputSchema: {
    account_id: z.string().uuid(),
    starting_balance: z.number(),
    operating_risk_per_trade_percent: z.number(),
    hard_risk_per_trade_percent: z.number(),
    max_daily_loss_percent: z.number().nullable().optional(),
    max_total_loss_percent: z.number().nullable().optional(),
    trailing_drawdown: z.boolean().optional(),
    max_trades_per_day: z.number().int().nullable().optional(),
  },
  annotations: propose,
  handler: async (input, ctx) =>
    withUser(ctx, (db, uid) => runProposeRiskPolicy(db, uid, input, "mcp")),
});

export const proposeCohortPolicy = defineTool({
  name: "propose_cohort_policy",
  title: "Propose an automatic-trading rule",
  description:
    "Creates a pending allow/reduce/block proposal for one instrument and direction of automatic orders. reduce needs risk_share_percent 25, 50 or 75. Saved only after the user approves.",
  inputSchema: {
    instrument: z.string(),
    direction: z.enum(["long", "short"]),
    policy: z.enum(["allow", "reduce", "block"]),
    risk_share_percent: z.number().int().nullable().optional(),
  },
  annotations: propose,
  handler: async (input, ctx) =>
    withUser(ctx, (db, uid) => runProposeCohortPolicy(db, uid, input, "mcp")),
});

export const V09_TOOLS = [
  getRiskPolicy,
  listReviewItems,
  listRestingOrders,
  getCohortPolicies,
  listNewsBlackouts,
  runRuntimeValidationTool,
  proposeRiskPolicy,
  proposeCohortPolicy,
  proposeCancelOrder,
];
