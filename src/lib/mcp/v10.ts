/**
 * v1.0 MCP trading tools. An outside AI app can trade ONLY inside a session the
 * user approved on P-Trades (request_trading_access -> approve_url). Sessions
 * are bound to the calling OAuth client, time-limited, capped and revocable;
 * bodies live in src/lib/ai-tools/trading.server.ts and are shared with the
 * in-app assistant.
 */
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "./supabase";
import { runRequestTradingAccess } from "@/lib/ai-tools/bodies";

const unauth = { content: [{ type: "text" as const, text: "Not authenticated" }], isError: true };
const act = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };

function clientOf(ctx: ToolContext): string {
  return ctx.getClientId() ?? "unknown_mcp_client";
}

async function trading() {
  return import("@/lib/ai-tools/trading.server");
}

export const requestTradingAccess = defineTool({
  name: "request_trading_access",
  title: "Request a trading session",
  description:
    "Ask the user for a time-limited session in which you may place, change and close trades or arm accounts. Returns approve_url; nothing can trade until the user approves there (they may narrow it). Sessions last 15, 60, 240 or 480 minutes.",
  inputSchema: {
    account_ids: z.array(z.string().uuid()).describe("Accounts from list_my_accounts."),
    actions: z.array(z.enum(["place", "modify", "close", "arm"])),
    minutes: z.number().int().optional(),
    max_orders: z.number().int().optional(),
    max_risk_percent: z.number().optional().describe("Max risk per new order, % of equity (≤5)."),
    include_live: z.boolean().optional().describe("true to include real-money accounts."),
    reason: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return unauth;
    return runRequestTradingAccess(supabaseForUser(ctx), ctx.getUserId() as string, input, "mcp", clientOf(ctx));
  },
});

export const getTradingAccess = defineTool({
  name: "get_trading_access",
  title: "Get my trading session",
  description: "Shows this AI app's active trading session (accounts, actions, orders left, max risk, expiry), or none.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_i, ctx) => {
    if (!ctx.isAuthenticated()) return unauth;
    const t = await trading();
    return t.runGetTradingAccess(supabaseForUser(ctx), ctx.getUserId() as string, clientOf(ctx));
  },
});

export const placeOrder = defineTool({
  name: "place_order",
  title: "Place an order",
  description:
    "Place a market or limit order inside an approved session. Stop loss and take profit are required. Size is ALWAYS calculated by P-Trades from the account's risk policy and session limit — you cannot set it. Every order re-runs the nine safety checks, cohort rules, news blackout and duplicate guard first.",
  inputSchema: {
    account_id: z.string().uuid(),
    instrument: z.string(),
    direction: z.enum(["long", "short"]),
    order_type: z.enum(["market", "limit"]),
    entry_price: z.number().optional().describe("Required for limit orders."),
    stop_loss: z.number(),
    take_profit: z.number(),
    expiry_minutes: z.number().int().optional(),
  },
  annotations: act,
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return unauth;
    return (await trading()).runPlaceOrder(ctx.getUserId() as string, clientOf(ctx), input);
  },
});

export const modifyPosition = defineTool({
  name: "modify_position",
  title: "Change a position's stop or target",
  description: "Move an open position's stop loss (and optionally take profit) inside an approved session.",
  inputSchema: {
    account_id: z.string().uuid(),
    position_id: z.string(),
    stop_loss: z.number(),
    take_profit: z.number().optional(),
  },
  annotations: act,
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return unauth;
    return (await trading()).runModifyPosition(ctx.getUserId() as string, clientOf(ctx), input);
  },
});

export const closePosition = defineTool({
  name: "close_position",
  title: "Close a position",
  description: "Close all of an open position, or part of it with volume, inside an approved session. Allowed even while an emergency stop is on.",
  inputSchema: { account_id: z.string().uuid(), position_id: z.string(), volume: z.number().optional() },
  annotations: act,
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return unauth;
    return (await trading()).runClosePosition(ctx.getUserId() as string, clientOf(ctx), input);
  },
});

export const modifyRestingOrder = defineTool({
  name: "modify_resting_order",
  title: "Change a waiting order",
  description: "Change a waiting order's entry, stop loss and take profit inside an approved session. Size is never changed.",
  inputSchema: {
    account_id: z.string().uuid(),
    order_id: z.string(),
    entry_price: z.number(),
    stop_loss: z.number(),
    take_profit: z.number(),
  },
  annotations: act,
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return unauth;
    return (await trading()).runModifyRestingOrder(ctx.getUserId() as string, clientOf(ctx), input);
  },
});

export const armAccount = defineTool({
  name: "arm_account",
  title: "Arm an account",
  description:
    "Switch an account to observe, demo_auto or live_confirm inside an approved session. live_confirm requires a passing Runtime Validation. Live auto can only be armed by the user in P-Trades.",
  inputSchema: { account_id: z.string().uuid(), mode: z.enum(["observe", "demo_auto", "live_confirm"]) },
  annotations: act,
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return unauth;
    return (await trading()).runArmAccount(ctx.getUserId() as string, clientOf(ctx), input);
  },
});

export const V10_TOOLS = [
  requestTradingAccess,
  getTradingAccess,
  placeOrder,
  modifyPosition,
  closePosition,
  modifyRestingOrder,
  armAccount,
];
