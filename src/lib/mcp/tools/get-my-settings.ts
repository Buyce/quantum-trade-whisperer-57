import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

export const MY_SETTINGS_COLUMNS =
  "instruments, sessions, min_grade, alert_min_grade, daily_setup_cap, notify_push, notify_email, order_strategy, account_equity, account_currency, risk_per_trade_percent, max_position_size, leverage, max_stop_loss_percent, equity_as_of, risk_ack_high, webhook_enabled, maximum_concurrent_signal_orders, maximum_daily_signal_orders, maximum_daily_orders_per_symbol, auto_order_window_minutes, adaptive_order_ceilings_enabled, adaptive_order_ceiling_max, adaptive_order_ceiling_floor, auto_market_entry_enabled, auto_exit_policy, auto_exit_shares, auto_exit_trail_runner, auto_execute_c_grade, auto_intel_gate_enabled, auto_intel_min_win_pct, auto_intel_min_sample, auto_intel_min_expected_r, allow_unmeasured_intel, max_entry_spread_pips, max_entry_slippage_pips, exposure_limit_enabled, max_total_exposure_percent, drawdown_brakes_enabled, daily_loss_limit_percent, weekly_loss_limit_percent, consecutive_loss_limit, consecutive_loss_pause_hours, max_drawdown_percent, max_same_bet_orders, same_bet_cooldown_minutes";

/** Shared body — the MCP handler and the in-app assistant call this same code. */
export async function runGetMySettings(supabase: unknown) {
  const db = supabase as ReturnType<typeof supabaseForUser>;
  const { data, error } = await db
    .from("scanner_settings")
    .select(MY_SETTINGS_COLUMNS)
    .maybeSingle();

  if (error) return { content: [{ type: "text" as const, text: error.message }], isError: true };

  // Per-cohort automatic-order rules live in their own owner-scoped table.
  const { data: cohortRows, error: cohortError } = await db
    .from("auto_cohort_policies")
    .select("instrument, direction, policy, risk_share_percent, updated_at");
  const cohortPolicies = cohortError ? null : (cohortRows ?? []);
  if (!data) {
    return {
      content: [{ type: "text" as const, text: "No settings row for this user yet." }],
      structuredContent: { settings: null },
    };
  }

  const payload = {
    settings: data,
    auto_cohort_policies: cohortPolicies,
    notes: {
      auto_cohort_policies:
        cohortPolicies === null
          ? "Per-pair-and-direction automatic-order rules could not be read, so make no claim about them."
          : "The user's own rule per instrument AND direction. Only cohorts they changed appear here; any cohort absent from this list is allowed at their normal risk. policy=block refuses automatic orders on that pair and side; policy=reduce places them with risk_share_percent of their normal per-trade risk. Reduce-only: it never causes an order, never enlarges one, and never affects the feed, alerts, publication, grading or any measurement.",
      daily_setup_cap:
        data.daily_setup_cap === 0 ? "unlimited" : `${data.daily_setup_cap} per day`,
      webhook_config: "Webhook URL and secret are intentionally not exposed to agents.",
      account_equity:
        "User-entered balance, not broker-confirmed. equity_as_of is when the user last set it; treat an old date as stale and ask them to confirm.",
      risk_ack_high:
        "True when the user explicitly accepted risking more than 2% of equity per trade.",
      automatic_order_rules:
        "Ceilings and the order window cap THROUGHPUT; none of them causes an order. maximum_concurrent_signal_orders is how many automatic orders may be unresolved at once, maximum_daily_signal_orders and maximum_daily_orders_per_symbol are per UTC day, auto_order_window_minutes is how long after detection a setup may still be ordered (0 disables automatic orders on age grounds).",
      gates:
        "Each gate only ever REFUSES. The intelligence gate reads the pair-and-direction replay history, not the setup's grade, so an A or B setup on a pair with weak measured history is refused just the same. The auto_intel_* values are descriptive in-sample measurements, never forecasts.",
      brakes:
        "Every brake is measured from CLOSED broker trades and the broker's own equity reading. 0 disables an individual limit, and drawdown_brakes_enabled false disables all of them. Brakes stop NEW automatic orders only; anything already at the broker is untouched. max_same_bet_orders (1-3, default 1) caps how many unresolved automatic orders may be live on the same instrument in the same direction — several separate setups on the same pair and side are one bet. same_bet_cooldown_minutes (0, 30, 60, 120) is how long that bet is refused after a broker-confirmed loss there; 0 is off.",
    },
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

export default defineTool({
  name: "get_my_settings",
  title: "Get my settings",
  description:
    "Read the signed-in user's complete customer-owned configuration: feed filters (instruments, sessions, minimum grade — every setup covers H4, H1 and M15 together, so timeframes are not a filter), alert preferences, daily cap (0 = unlimited; it governs feed and alert eligibility, each channel using its own grade threshold), risk profile (equity, currency, risk per trade, lot ceiling, leverage, max stop-loss percent), automatic-order rules (ceilings open-at-once / per day / per instrument, the order window, adaptive ceilings, market-entry mode), gates (C-Grade permission, intelligence-gate thresholds and sample floor, entry spread and slippage caps, exposure limit) and brakes (daily and weekly closed-loss limits, losing-run limit and pause length, peak-equity drawdown, same-bet limit and same-bet cool-off), plus the take-profit choice with its split and trailing setting. Webhook credentials are never returned.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    return runGetMySettings(supabaseForUser(ctx));
  },
});
