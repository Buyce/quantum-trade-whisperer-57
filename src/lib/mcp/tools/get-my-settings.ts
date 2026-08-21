import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_my_settings",
  title: "Get my settings",
  description:
    "Read the signed-in user's feed filters (instruments, timeframes, sessions, minimum grade), alert preferences, daily cap (0 = unlimited) and risk profile (account equity, currency, risk per trade, leverage, max stop-loss percent, max position size). Webhook credentials are never returned.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("scanner_settings")
      .select(
        "instruments, timeframes, sessions, min_grade, alert_min_grade, daily_setup_cap, notify_push, notify_email, order_strategy, account_equity, account_currency, risk_per_trade_percent, max_position_size, leverage, max_stop_loss_percent, webhook_enabled",
      )
      .maybeSingle();

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) {
      return {
        content: [{ type: "text", text: "No settings row for this user yet." }],
        structuredContent: { settings: null },
      };
    }

    const payload = {
      settings: data,
      notes: {
        daily_setup_cap: data.daily_setup_cap === 0 ? "unlimited" : `${data.daily_setup_cap} per day`,
        webhook_config: "Webhook URL and secret are intentionally not exposed to agents.",
      },
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
