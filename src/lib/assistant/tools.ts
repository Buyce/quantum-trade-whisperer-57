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
import { runListBrokerTrades } from "@/lib/mcp/tools/list-broker-trades";
import { runListMyAccounts } from "@/lib/mcp/tools/list-my-accounts";
import { runGetPerformanceSummary } from "@/lib/mcp/tools/get-performance-summary";
import { runGetPlatformBenchmarks } from "@/lib/mcp/tools/get-platform-benchmarks";
import { searchPlatformDocs } from "@/lib/assistant/knowledge";
import {
  cancelProposalInput,
  cohortProposalInput,
  riskPolicyProposalInput,
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
import { ABILITIES, AI_NEVER } from "@/lib/ai-tools/registry";
import {
  armInput,
  closePositionInput,
  modifyOrderInput,
  modifyPositionInput,
  placeOrderInput,
} from "@/lib/ai-tools/trading";

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

/** v0.9 tools shared with MCP (src/lib/mcp/v09.ts) via src/lib/ai-tools/bodies.ts. */
function v09Tools(supabase: unknown, userId: string) {
  return {
    what_can_you_do: tool({
      description:
        "List everything the assistant can read, check, change (with approval) or cancel (with approval), and what it can never do. Use when the user asks what you can do.",
      inputSchema: z.object({}),
      execute: async () => ({
        abilities: ABILITIES.filter((a) => a.surfaces.includes("in_app")).map((a) => ({
          name: a.name,
          access: a.access,
          summary: a.summary,
        })),
        never: AI_NEVER,
      }),
    }),
    get_risk_policy: tool({
      description:
        "Each of the user's connected accounts with its risk policy. policy null = Not set (automatic orders stay blocked).",
      inputSchema: z.object({ account_id: z.string().nullable().optional() }),
      execute: async (a) =>
        unwrap(await runGetRiskPolicy(supabase, userId, { account_id: a.account_id ?? undefined })),
    }),
    list_review_items: tool({
      description:
        "Broker-vs-platform mismatches flagged by the scheduled reconciliation for the user's accounts. Nothing is auto-corrected.",
      inputSchema: z.object({ include_resolved: z.boolean().nullable().optional() }),
      execute: async (a) =>
        unwrap(
          await runListReviewItems(supabase, userId, {
            include_resolved: a.include_resolved ?? undefined,
          }),
        ),
    }),
    list_resting_orders: tool({
      description:
        "The user's unfilled orders P-Trades placed that are still waiting at the broker (delivery ids for propose_cancel_order).",
      inputSchema: z.object({}),
      execute: async () => unwrap(await runListRestingOrders(supabase, userId)),
    }),
    get_cohort_policies: tool({
      description:
        "The user's allow / reduce / block automatic-trading rules per instrument and direction.",
      inputSchema: z.object({}),
      execute: async () => unwrap(await runGetCohortPolicies(supabase, userId)),
    }),
    list_news_blackouts: tool({
      description:
        "Upcoming high-impact economic events (default next 48h), optionally for one instrument.",
      inputSchema: z.object({
        hours: z.number().int().nullable().optional(),
        instrument: z.string().nullable().optional(),
      }),
      execute: async (a) =>
        unwrap(
          await runListNewsBlackouts(supabase, {
            hours: a.hours ?? undefined,
            instrument: a.instrument ?? undefined,
          }),
        ),
    }),
    run_runtime_validation: tool({
      description:
        "Run the nine-check Runtime Validation (dry run, never trades) on one of the user's own accounts. Needs account_id (from list_my_accounts), symbol, direction and stop_distance in price units.",
      inputSchema: z.object({
        account_id: z.string(),
        symbol: z.string(),
        direction: z.enum(["long", "short"]),
        stop_distance: z.number(),
      }),
      execute: async (a) => {
        const db = supabase as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
        const { data } = await db
          .from("connected_trading_accounts")
          .select("id")
          .eq("id", a.account_id)
          .eq("user_id", userId)
          .maybeSingle();
        if (!data)
          return unwrap(envelope({ error: "Account not found among your accounts." }, true));
        const { runRuntimeValidation } = await import("@/lib/validation/runtime.server");
        return runRuntimeValidation(db as never, {
          accountId: a.account_id,
          symbol: a.symbol,
          direction: a.direction,
          stopDistance: a.stop_distance,
        });
      },
    }),
    propose_risk_policy: tool({
      description:
        "Propose a risk policy for one of the user's accounts. Creates a pending proposal the user approves in a card; nothing is saved before that.",
      inputSchema: riskPolicyProposalInput,
      execute: async (a) => unwrap(await runProposeRiskPolicy(supabase, userId, a, "in_app")),
    }),
    propose_cohort_policy: tool({
      description:
        "Propose allow / reduce (25, 50 or 75% risk) / block for automatic orders on one instrument and direction. Pending until the user approves.",
      inputSchema: cohortProposalInput,
      execute: async (a) => unwrap(await runProposeCohortPolicy(supabase, userId, a, "in_app")),
    }),
    propose_cancel_order: tool({
      description:
        "Propose cancelling one of the user's WAITING orders (delivery_id from list_resting_orders). Nothing is cancelled until the user taps Approve.",
      inputSchema: cancelProposalInput,
      execute: async (a) => unwrap(await runProposeCancelOrder(supabase, userId, a, "in_app")),
    }),
  };
}

/** v1.0 trading-session tools, same bodies as src/lib/mcp/v10.ts. Client id "in_app". */
function v10Tools(supabase: unknown, userId: string) {
  const t = () => import("@/lib/ai-tools/trading.server");
  return {
    request_trading_access: tool({
      description:
        "Ask the user for a time-limited trading session (accounts, actions place/modify/close/arm, minutes 15/60/240/480, max_orders, max_risk_percent, include_live). Shows an Approve card; nothing trades until they approve.",
      inputSchema: z.object({
        account_ids: z.array(z.string().uuid()),
        actions: z.array(z.enum(["place", "modify", "close", "arm"])),
        minutes: z.number().int().optional(),
        max_orders: z.number().int().optional(),
        max_risk_percent: z.number().optional(),
        include_live: z.boolean().optional(),
        reason: z.string().optional(),
      }),
      execute: async (a) => {
        const { runRequestTradingAccess } = await import("@/lib/ai-tools/bodies");
        return unwrap(await runRequestTradingAccess(supabase, userId, a, "in_app", "in_app"));
      },
    }),
    get_trading_access: tool({
      description: "The assistant's active trading session, or none.",
      inputSchema: z.object({}),
      execute: async () =>
        unwrap(await (await t()).runGetTradingAccess(supabase, userId, "in_app")),
    }),
    place_order: tool({
      description:
        "Place a market or limit order inside the approved session. Stop loss and take profit required; P-Trades sets the size and re-runs every safety check.",
      inputSchema: placeOrderInput,
      execute: async (a) => unwrap(await (await t()).runPlaceOrder(userId, "in_app", a)),
    }),
    modify_position: tool({
      description: "Move an open position's stop loss / take profit inside the approved session.",
      inputSchema: modifyPositionInput,
      execute: async (a) => unwrap(await (await t()).runModifyPosition(userId, "in_app", a)),
    }),
    close_position: tool({
      description:
        "Close all (or part, with volume) of an open position inside the approved session.",
      inputSchema: closePositionInput,
      execute: async (a) => unwrap(await (await t()).runClosePosition(userId, "in_app", a)),
    }),
    modify_resting_order: tool({
      description:
        "Change a waiting order's entry/stop/target inside the approved session. Never its size.",
      inputSchema: modifyOrderInput,
      execute: async (a) => unwrap(await (await t()).runModifyRestingOrder(userId, "in_app", a)),
    }),
    arm_account: tool({
      description:
        "Arm an account to observe, demo_auto or live_confirm inside the approved session.",
      inputSchema: armInput,
      execute: async (a) => unwrap(await (await t()).runArmAccount(userId, "in_app", a)),
    }),
  };
}

export function buildAssistantTools(supabase: unknown, userId: string) {
  return {
    ...v09Tools(supabase, userId),
    ...v10Tools(supabase, userId),
    list_signals: tool({
      description:
        "List trade setups published by the live scanner. scope='all_published' (default) returns retained published rows; scope='my_scanner' returns rows currently eligible under this user's feed settings, retention window and daily cap. An empty result means nothing matched the filters — it is NOT evidence about the scanner's cycle.",
      inputSchema: z.object({
        instrument: z
          .string()
          .nullable()
          .optional()
          .describe("Optional instrument filter, e.g. XAUUSD."),
        min_grade: z
          .enum(["A+", "A", "B", "C"])
          .nullable()
          .optional()
          .describe("Only setups at or above this grade tier."),
        scope: z.enum(["all_published", "my_scanner"]).nullable().optional(),
        limit: z.number().nullable().optional().describe("Max rows (1-50, default 10)."),
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
        hours: z.number().nullable().optional().describe("Look-back in hours (1-168, default 24)."),
        limit: z
          .number()
          .nullable()
          .optional()
          .describe("Max rows per section (1-100, default 25)."),
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
        instruments: z.array(z.string()).nullable().optional(),
        sessions: z.array(z.string()).nullable().optional(),
        min_grade: z.string().nullable().optional(),
        alert_min_grade: z.string().nullable().optional(),
        daily_setup_cap: z.number().nullable().optional(),
        notify_push: z.boolean().nullable().optional(),
        notify_email: z.boolean().nullable().optional(),
        account_equity: z.number().nullable().optional(),
        account_currency: z.string().nullable().optional(),
        risk_per_trade_percent: z.number().nullable().optional(),
        max_position_size: z.number().nullable().optional(),
        leverage: z.number().nullable().optional(),
        max_stop_loss_percent: z.number().nullable().optional(),
        risk_ack_high: z.boolean().nullable().optional(),
        maximum_concurrent_signal_orders: z.number().nullable().optional(),
        maximum_daily_signal_orders: z.number().nullable().optional(),
        maximum_daily_orders_per_symbol: z.number().nullable().optional(),
        auto_order_window_minutes: z.number().nullable().optional(),
        adaptive_order_ceilings_enabled: z.boolean().nullable().optional(),
        adaptive_order_ceiling_max: z.number().nullable().optional(),
        adaptive_order_ceiling_floor: z.number().nullable().optional(),
        auto_market_entry_enabled: z.boolean().nullable().optional(),
        auto_execute_c_grade: z.boolean().nullable().optional(),
        auto_intel_gate_enabled: z.boolean().nullable().optional(),
        auto_intel_min_win_pct: z.number().nullable().optional(),
        auto_intel_min_sample: z.number().nullable().optional(),
        auto_intel_min_expected_r: z.number().nullable().optional(),
        allow_unmeasured_intel: z.boolean().nullable().optional(),
        max_entry_spread_pips: z.number().nullable().optional(),
        max_entry_slippage_pips: z.number().nullable().optional(),
        exposure_limit_enabled: z.boolean().nullable().optional(),
        max_total_exposure_percent: z.number().nullable().optional(),
        drawdown_brakes_enabled: z.boolean().nullable().optional(),
        daily_loss_limit_percent: z.number().nullable().optional(),
        weekly_loss_limit_percent: z.number().nullable().optional(),
        consecutive_loss_limit: z.number().nullable().optional(),
        consecutive_loss_pause_hours: z.number().nullable().optional(),
        max_drawdown_percent: z.number().nullable().optional(),
        max_same_bet_orders: z.number().nullable().optional(),
        same_bet_cooldown_minutes: z.number().nullable().optional(),
        auto_cohort_policies: z
          .array(
            z.object({
              instrument: z.string(),
              direction: z.enum(["long", "short"]),
              policy: z.enum(["allow", "reduce", "block"]),
              risk_share_percent: z.number().nullable().optional(),
            }),
          )
          .nullable()
          .optional()
          .describe(
            "Per-pair AND direction automatic-order rules, e.g. EURUSD short. block refuses automatic orders on that cohort; reduce places them with risk_share_percent of normal per-trade risk; allow clears the rule. Reduce-only and requires confirm_risk_change: true.",
          ),
        confirm_risk_change: z
          .boolean()
          .nullable()
          .optional()
          .describe(
            "True ONLY when the user explicitly approved this exact risk change in this conversation.",
          ),
      }),
      execute: async (args) => {
        const input: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(args)) {
          if (value === null || value === undefined) continue;
          if (key === "auto_cohort_policies" && Array.isArray(value)) {
            input[key] = value.map((entry) => {
              const row = entry as Record<string, unknown>;
              const share = row["risk_share_percent"];
              return {
                instrument: row["instrument"],
                direction: row["direction"],
                policy: row["policy"],
                ...(typeof share === "number" ? { risk_share_percent: share } : {}),
              };
            });
            continue;
          }
          input[key] = value;
        }
        return unwrap(await runUpdateMySettings(supabase, userId, input));
      },
    }),
    calculate_position_size: tool({
      description:
        "Size a setup with the user's saved risk profile through the same server sizing service the terminal uses. Pass a signal_id from list_signals, or instrument + entry_price + stop_loss. Returns explicit unavailable reasons instead of guesses.",
      inputSchema: z.object({
        signal_id: z.string().nullable().optional(),
        instrument: z.string().nullable().optional(),
        entry_price: z.number().nullable().optional(),
        stop_loss: z.number().nullable().optional(),
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
        signal_id: z.string().nullable().optional(),
        instrument: z.string().nullable().optional(),
        direction: z.string().nullable().optional(),
        session: z.string().nullable().optional(),
        volatility_index: z.number().nullable().optional(),
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
    list_my_accounts: tool({
      description:
        "The user's own connected broker accounts — DEMO and LIVE — with mode, phase, intent, broker and server, masked login, currency, broker-reported balance, equity, free margin, margin level, leverage, trade permission, connection/provisioning state, emergency stop or stand-down reason and when the broker figures were observed. Use it to attribute a trade, order or log line to an account, and to answer anything about demo accounts. Always name the account mode; a demo result is not a live track record.",
      inputSchema: z.object({
        mode: z.enum(["demo", "live", "all"]).nullable().optional(),
        include_disconnected: z.boolean().nullable().optional(),
      }),
      execute: async (args) =>
        unwrap(
          await runListMyAccounts(supabase, {
            mode: args.mode ?? undefined,
            include_disconnected: args.include_disconnected ?? undefined,
          }),
        ),
    }),
    list_broker_trades: tool({
      description:
        "The user's BROKER-CONFIRMED trades from broker evidence across ALL their accounts, demo and live — the authority on what actually happened: instrument, direction, volume, entry/exit price and time, commission, swap, gross profit, R against plan and against actual risk, stop provenance, slippage and the setup grade. Use this FIRST for any question about the user's trades, results or best/worst trade. Set order_by: 'r_vs_actual_risk' for best trades. An empty result means nothing matched THIS query, never that the user has no trades.",
      inputSchema: z.object({
        state: z.enum(["closed", "open", "all"]).nullable().optional(),
        instrument: z.string().nullable().optional(),
        account_type: z
          .enum(["demo", "live", "all"])
          .nullable()
          .optional()
          .describe("Account mode. Default: all — demo and live together."),
        account_id: z
          .string()
          .nullable()
          .optional()
          .describe("One connected account id from list_my_accounts."),
        days: z.number().int().nullable().optional().describe("Look-back on the broker exit time."),
        from: z.string().nullable().optional(),
        to: z.string().nullable().optional(),
        order_by: z.enum(["exit_at", "r_vs_actual_risk"]).nullable().optional(),
        limit: z.number().int().nullable().optional().describe("Max rows (1-100, default 20)."),
      }),
      execute: async (args) =>
        unwrap(
          await runListBrokerTrades(supabase, {
            state: args.state ?? undefined,
            instrument: args.instrument ?? undefined,
            account_type: args.account_type ?? undefined,
            account_id: args.account_id ?? undefined,
            days: args.days ?? undefined,
            from: args.from ?? undefined,
            to: args.to ?? undefined,
            order_by: args.order_by ?? undefined,
            limit: args.limit ?? undefined,
          }),
        ),
    }),
    list_my_trades: tool({
      description:
        "The user's SELF-REPORTED journal entries (hand-logged decisions and outcomes) with fill-price provenance. This is notes, not the broker record — it can be empty even when the user traded, so never report an empty journal as 'no trades'. Use list_broker_trades for what actually happened.",
      inputSchema: z.object({
        limit: z.number().nullable().optional().describe("Max rows (1-100, default 20)."),
      }),
      execute: async (args) =>
        unwrap(await runListMyTrades(supabase, { limit: args.limit ?? undefined })),
    }),
    get_performance_summary: tool({
      description:
        "The user's trading performance from logged trades on an explicit R basis ('actual_risk' default, or 'plan'; never mixed), optionally restricted to a UTC window. For 'the past 2 weeks' pass days: 14. Trades are placed in the window by broker exit time when known, record time otherwise, and the response reports the window it used. Descriptive, small-sample.",
      inputSchema: z.object({
        r_basis: z.enum(["actual_risk", "plan"]).nullable().optional(),
        days: z
          .number()
          .int()
          .nullable()
          .optional()
          .describe("Look-back in days from now (UTC). Use for 'last N days/weeks/months'."),
        from: z
          .string()
          .nullable()
          .optional()
          .describe("ISO UTC start of the window. Overrides days."),
        to: z
          .string()
          .nullable()
          .optional()
          .describe("ISO UTC end of the window. Defaults to now."),
      }),
      execute: async (args) =>
        unwrap(
          await runGetPerformanceSummary(supabase, {
            r_basis: args.r_basis ?? undefined,
            days: args.days ?? undefined,
            from: args.from ?? undefined,
            to: args.to ?? undefined,
          }),
        ),
    }),
    get_platform_benchmarks: tool({
      description:
        "Platform-wide learning and outcome evidence aggregated across ALL accounts: published setup counts, per-grade and per-instrument broker-verified outcome rates and average R, replay/shadow coverage, and instrument lifecycle stages. Aggregate-only by construction: it never contains another user's money, equity, lot sizes, account names or identity. Use it to compare the user's own results (from get_performance_summary) against the platform in R-multiples and percentages only. Cohorts below the minimum group size are withheld.",
      inputSchema: z.object({}),
      execute: async () => unwrap(await runGetPlatformBenchmarks(supabase)),
    }),
    search_platform_docs: tool({
      description:
        "Search P-Trades' own written specification (grading, eligibility and caps, risk sizing, R and journal maths, brakes and gates, execution semantics, instrument lifecycle, market context, research and shadow replay, glossary). Use this before explaining HOW the platform works — quote the document instead of improvising. Outside web material is never a substitute for these rules.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("What to look up, e.g. 'A+ grade', 'resting order', 'expected R'."),
        limit: z.number().int().nullable().optional().describe("Max passages (1-6, default 3)."),
      }),
      execute: async (args) => searchPlatformDocs(args.query, args.limit ?? undefined),
    }),
  };
}

export type AssistantTools = ReturnType<typeof buildAssistantTools>;
