import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { validateSettings } from "../settings-validation";

export default defineTool({
  name: "update_my_settings",
  title: "Update my settings",
  description:
    "Change the signed-in user's own feed filters, alert grade, daily cap (0 = unlimited), notification preferences and risk profile. Only the fields you pass are changed; values outside safe bounds are clamped and reported back. Webhook URL and secret cannot be changed by an agent.",
  inputSchema: {
    instruments: z.array(z.string()).optional().describe("Subset of XAUUSD, GBPAUD, EURUSD."),
    timeframes: z.array(z.string()).optional().describe("Subset of H4, H1, M15."),
    sessions: z
      .array(z.string())
      .optional()
      .describe("Subset of sydney, tokyo, london, london_new_york_overlap, new_york."),
    min_grade: z.string().optional().describe("Lowest grade shown in the feed: A+, A, B or C."),
    alert_min_grade: z.string().optional().describe("Lowest grade that triggers alerts."),
    daily_setup_cap: z.number().optional().describe("Max graded setups alerted per day; 0 = unlimited."),
    notify_push: z.boolean().optional(),
    notify_email: z.boolean().optional(),
    account_equity: z.number().optional().describe("Account balance in the account currency."),
    account_currency: z.string().optional().describe("USD, EUR, GBP or AUD."),
    risk_per_trade_percent: z.number().optional().describe("Percent of equity risked per trade (0.1-10)."),
    max_position_size: z.number().optional().describe("Hard lot ceiling; 0 disables the cap."),
    leverage: z.number().optional().describe("Account leverage (1-500)."),
    max_stop_loss_percent: z
      .number()
      .optional()
      .describe("Maximum stop distance as a percent of entry; 0 disables the check."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const { patch, warnings } = validateSettings(input);
    if (Object.keys(patch).length === 0) {
      const text = warnings.length
        ? `Nothing changed. ${warnings.join(" ")}`
        : "Nothing changed: no recognised settings were supplied.";
      return { content: [{ type: "text", text }], isError: true };
    }

    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("scanner_settings")
      .update(patch)
      .eq("user_id", ctx.getUserId() as string)
      .select(
        "instruments, timeframes, sessions, min_grade, alert_min_grade, daily_setup_cap, notify_push, notify_email, account_equity, account_currency, risk_per_trade_percent, max_position_size, leverage, max_stop_loss_percent",
      );

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data || data.length === 0) {
      return {
        content: [{ type: "text", text: "No settings row found for this user." }],
        isError: true,
      };
    }

    const payload = { updated: Object.keys(patch), settings: data[0], warnings };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
