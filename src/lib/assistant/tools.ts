/**
 * AI SDK tool definitions for the in-app assistant.
 *
 * [INVARIANT] Every tool delegates to the SAME shared body the MCP tools use —
 * there is no second implementation of eligibility, sizing, R-maths, brakes or
 * settings validation. The supabase client passed in is the caller's own
 * bearer-scoped client, so every read and write runs under RLS as that user.
 */
import { tool } from "ai";
import { z } from "zod";
import { runListSignals, type SignalsClient } from "@/lib/mcp/tools/list-signals";
import { runGetScannerStatus } from "@/lib/mcp/tools/get-scanner-status";
import { runGetMarketStatus } from "@/lib/mcp/tools/get-market-status";
import { runGetAutomaticOrders } from "@/lib/mcp/tools/get-automatic-orders";
import { runGetRiskHolds } from "@/lib/mcp/tools/get-risk-holds";
import { runGetMySettings } from "@/lib/mcp/tools/get-my-settings";
import { runUpdateMySettings } from "@/lib/mcp/tools/update-my-settings";
import { runCalculatePositionSize } from "@/lib/mcp/tools/calculate-position-size";
import { runGetIntelligence } from "@/lib/mcp/tools/get-intelligence";
import { runGetShadowComparison } from "@/lib/mcp/tools/get-shadow-comparison";
import { runListMyTrades } from "@/lib/mcp/tools/list-my-trades";
import { runGetPerformanceSummary } from "@/lib/mcp/tools/get-performance-summary";

/** The shared bodies return the MCP envelope; the model only needs the payload. */
function unwrap(result: {
  structuredContent?: unknown;
  content: { type: string; text: string }[];
  isError?: boolean;
}) {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const first = result.content[0];
  return { message: first?.text ?? "", error: result.isError === true || undefined };
}

export function buildAssistantTools(supabase: unknown, userId: string) {
  return {
    list_signals: tool({
      description:
        "List trade setups published by the live scanner. scope='all_published' (default) returns retained published rows; scope='my_scanner' returns rows currently eligible under this user's feed settings, retention window and daily cap. An empty result means nothing matched the filters — it is NOT evidence about the scanner's cycle.",
      inputSchema: z.object({
        instrument: z.string().nullable().describe("Optional instrument filter, e.g. XAUUSD."),
        min_grade: z
          .enum(["A+", "A", "B", "C"])
          .nullable()
          .describe("Only setups at or above this grade tier."),
        scope: z.enum(["all_published", "my_scanner"]).nullable(),
        limit: z.number().nullable().describe("Max rows (1-50, default 10)."),
      }),
      execute: async (args) =>
        unwrap(
          await runListSignals(supabase as SignalsClient, {
            instrument: args.instrument ?? undefined,
            min_grade: args.min_grade ?? undefined,
            scope: args.scope ?? undefined,
            limit: args.limit ?? undefined,
          }),
        ),
    }),
    get_scanner_status: tool({
      description:
        "Live scanner health per instrument plus the user's feed and alert filter settings. The authority on whether the engine is cycling.",
      inputSchema: z.object({}),
      execute: async () => unwrap(await runGetScannerStatus(supabase)),
    }),
    get_market_status: tool({
      description:
        "Which FX sessions are open right now, weekend closure state, the scanner's current session bucket, and per-instrument broker feed health.",
      inputSchema: z.object({}),
      execute: async () => unwrap(await runGetMarketStatus(supabase)),
    }),
    get_automatic_orders: tool({
      description:
        "The user's recent automatic-order decisions (queued or refused with the exact reason) and broker deliveries with their last known state. Resting is not filled. Empty means nothing matched this window.",
      inputSchema: z.object({
        hours: z.number().nullable().describe("Look-back in hours (1-168, default 24)."),
        limit: z.number().nullable().describe("Max rows per section (1-100, default 25)."),
      }),
      execute: async (args) =>
        unwrap(
          await runGetAutomaticOrders(supabase, {
            hours: args.hours ?? undefined,
            limit: args.limit ?? undefined,
          }),
        ),
    }),
    get_risk_holds: tool({
      description:
        "Whether the user's automatic orders are currently held by a risk brake, which rule, when it lifts, and pause-cancellation counts. Measured from closed broker trades only; a hold stops NEW orders only.",
      inputSchema: z.object({}),
      execute: async () => unwrap(await runGetRiskHolds(supabase, userId)),
    }),
    get_my_settings: tool({
      description:
        "The user's complete configuration: feed filters, alerts, daily cap, risk profile, automatic-order rules, gates and brakes. Webhook credentials are never returned.",
      inputSchema: z.object({}),
      execute: async () => unwrap(await runGetMySettings(supabase)),
    }),
    update_my_settings: tool({
      description:
        "Change the user's own settings. Fields that change how much real money can be at risk require confirm_risk_change: true, which asserts the USER explicitly approved that exact change in this conversation — never set it on your own initiative. Values are clamped to safe bounds; warnings must be repeated verbatim.",
      needsApproval: async () => true,
      inputSchema: z.object({
        instruments: z.array(z.string()).nullable(),
        sessions: z.array(z.string()).nullable(),
        min_grade: z.string().nullable(),
        alert_min_grade: z.string().nullable(),
        daily_setup_cap: z.number().nullable(),
        notify_push: z.boolean().nullable(),
        notify_email: z.boolean().nullable(),
        account_equity: z.number().nullable(),
        account_currency: z.string().nullable(),
        risk_per_trade_percent: z.number().nullable(),
        max_position_size: z.number().nullable(),
        leverage: z.number().nullable(),
        max_stop_loss_percent: z.number().nullable(),
        risk_ack_high: z.boolean().nullable(),
        maximum_concurrent_signal_orders: z.number().nullable(),
        maximum_daily_signal_orders: z.number().nullable(),
        maximum_daily_orders_per_symbol: z.number().nullable(),
        auto_order_window_minutes: z.number().nullable(),
        adaptive_order_ceilings_enabled: z.boolean().nullable(),
        adaptive_order_ceiling_max: z.number().nullable(),
        adaptive_order_ceiling_floor: z.number().nullable(),
        auto_market_entry_enabled: z.boolean().nullable(),
        auto_execute_c_grade: z.boolean().nullable(),
        auto_intel_gate_enabled: z.boolean().nullable(),
        auto_intel_min_win_pct: z.number().nullable(),
        auto_intel_min_sample: z.number().nullable(),
        auto_intel_min_expected_r: z.number().nullable(),
        allow_unmeasured_intel: z.boolean().nullable(),
        max_entry_spread_pips: z.number().nullable(),
        max_entry_slippage_pips: z.number().nullable(),
        exposure_limit_enabled: z.boolean().nullable(),
        max_total_exposure_percent: z.number().nullable(),
        drawdown_brakes_enabled: z.boolean().nullable(),
        daily_loss_limit_percent: z.number().nullable(),
        weekly_loss_limit_percent: z.number().nullable(),
        consecutive_loss_limit: z.number().nullable(),
        consecutive_loss_pause_hours: z.number().nullable(),
        max_drawdown_percent: z.number().nullable(),
        max_same_bet_orders: z.number().nullable(),
        same_bet_cooldown_minutes: z.number().nullable(),
        confirm_risk_change: z
          .boolean()
          .nullable()
          .describe(
            "True ONLY when the user explicitly approved this exact risk change in this conversation.",
          ),
      }),
      execute: async (args) => {
        const input: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(args)) {
          if (value !== null && value !== undefined) input[key] = value;
        }
        return unwrap(await runUpdateMySettings(supabase, userId, input));
      },
    }),
    calculate_position_size: tool({
      description:
        "Size a setup with the user's saved risk profile through the same server sizing service the terminal uses. Pass a signal_id from list_signals, or instrument + entry_price + stop_loss. Returns explicit unavailable reasons instead of guesses.",
      inputSchema: z.object({
        signal_id: z.string().nullable(),
        instrument: z.string().nullable(),
        entry_price: z.number().nullable(),
        stop_loss: z.number().nullable(),
      }),
      execute: async (args) =>
        unwrap(
          await runCalculatePositionSize(supabase, userId, {
            signal_id: args.signal_id ?? undefined,
            instrument: args.instrument ?? undefined,
            entry_price: args.entry_price ?? undefined,
            stop_loss: args.stop_loss ?? undefined,
          }),
        ),
    }),
    get_intelligence: tool({
      description:
        "Descriptive, hierarchically shrunk replay rates for a setup (fill rate, TP1-if-filled rate, sample sizes, reporting-gate status). In-sample replay summaries, never forecasts. Pass signal_id or instrument/direction/session.",
      inputSchema: z.object({
        signal_id: z.string().nullable(),
        instrument: z.string().nullable(),
        direction: z.string().nullable(),
        session: z.string().nullable(),
        volatility_index: z.number().nullable(),
      }),
      execute: async (args) =>
        unwrap(
          await runGetIntelligence(supabase, {
            signal_id: args.signal_id ?? undefined,
            instrument: args.instrument ?? undefined,
            direction: args.direction ?? undefined,
            session: args.session ?? undefined,
            volatility_index: args.volatility_index ?? undefined,
          }),
        ),
    }),
    get_shadow_comparison: tool({
      description:
        "Deterministic shadow-replay summaries for high-grade vs lower-grade setups over the last 7 days. In-sample, not causal, not a live track record.",
      inputSchema: z.object({}),
      execute: async () => unwrap(await runGetShadowComparison(supabase)),
    }),
    list_my_trades: tool({
      description:
        "The user's logged trade decisions and outcomes with fill-price provenance.",
      inputSchema: z.object({
        limit: z.number().nullable().describe("Max rows (1-100, default 20)."),
      }),
      execute: async (args) =>
        unwrap(await runListMyTrades(supabase, { limit: args.limit ?? undefined })),
    }),
    get_performance_summary: tool({
      description:
        "The user's trading performance from logged trades on an explicit R basis ('actual_risk' default, or 'plan'; never mixed). Descriptive, small-sample.",
      inputSchema: z.object({
        r_basis: z.enum(["actual_risk", "plan"]).nullable(),
      }),
      execute: async (args) =>
        unwrap(await runGetPerformanceSummary(supabase, { r_basis: args.r_basis ?? undefined })),
    }),
  };
}

export type AssistantTools = ReturnType<typeof buildAssistantTools>;
