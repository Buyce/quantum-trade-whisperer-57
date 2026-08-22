import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { SENSITIVE_RISK_FIELDS, sensitiveFieldsIn, validateSettings } from "../settings-validation";

export default defineTool({
  name: "update_my_settings",
  title: "Update my settings",
  description:
    "Change the signed-in user's own feed filters, alert grade, daily cap (0 = unlimited; the cap governs feed and alert eligibility, each channel using its own grade threshold), notification preferences and risk profile. Only the fields you pass are changed; values outside safe bounds are clamped and reported back. Webhook URL and secret cannot be changed by an agent. Changing any risk field (account_equity, account_currency, risk_per_trade_percent, max_position_size, leverage, max_stop_loss_percent) additionally requires confirm_risk_change: true, which asserts the user explicitly approved that change in this conversation; never set it on your own initiative.",
  inputSchema: {
    instruments: z.array(z.string()).optional().describe("Subset of XAUUSD, GBPAUD, EURUSD."),
    timeframes: z.array(z.string()).optional().describe("Subset of H4, H1, M15."),
    sessions: z
      .array(z.string())
      .optional()
      .describe("Subset of sydney, tokyo, london, london_new_york_overlap, new_york."),
    min_grade: z.string().optional().describe("Lowest grade shown in the feed: A+, A, B or C."),
    alert_min_grade: z.string().optional().describe("Lowest grade that triggers alerts."),
    daily_setup_cap: z
      .number()
      .optional()
      .describe(
        "Max graded (A+/A/B) setups per UTC day; 0 = unlimited. The cap governs both feed and alert eligibility, each channel counting against its own grade threshold (min_grade for the feed, alert_min_grade for alerts).",
      ),
    notify_push: z.boolean().optional(),
    notify_email: z.boolean().optional(),
    account_equity: z.number().optional().describe("Account balance in the account currency."),
    account_currency: z.string().optional().describe("USD, EUR, GBP or AUD."),
    risk_per_trade_percent: z
      .number()
      .optional()
      .describe("Percent of equity risked per trade (0.1-10)."),
    max_position_size: z.number().optional().describe("Hard lot ceiling; 0 disables the cap."),
    leverage: z.number().optional().describe("Account leverage (1-500)."),
    max_stop_loss_percent: z
      .number()
      .optional()
      .describe("Maximum stop distance as a percent of entry; 0 disables the check."),
    risk_ack_high: z
      .boolean()
      .optional()
      .describe(
        "Persisted acknowledgement that the user accepts risking more than 2% of equity per trade. Required (together with confirm_risk_change) before risk_per_trade_percent above 2 is applied; without it the percent is left unchanged.",
      ),
    confirm_risk_change: z
      .boolean()
      .optional()
      .describe(
        "Set true ONLY when the user has explicitly approved changing their risk profile (equity, currency, risk percent, max position size, leverage, max stop-loss percent). Required for those fields; it represents explicit user approval, not agent judgement, and does not relax validation or clamping.",
      ),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const { confirm_risk_change, ...settingsInput } = input;
    const sensitive = sensitiveFieldsIn(settingsInput);
    if (sensitive.length > 0 && confirm_risk_change !== true) {
      // Fail closed and write nothing: an unconfirmed risk change is refused in
      // full, including any non-sensitive fields sent alongside it.
      return {
        content: [
          {
            type: "text",
            text: `Refused: ${sensitive.join(", ")} affect position sizing on real money. Ask the user to confirm the exact change, then retry with confirm_risk_change: true. Sensitive fields: ${SENSITIVE_RISK_FIELDS.join(", ")}.`,
          },
        ],
        isError: true,
      };
    }
    const supabase = supabaseForUser(ctx);
    const userId = ctx.getUserId() as string;
    // Existing acknowledgement counts: a user who already accepted high risk
    // does not have to re-acknowledge on every subsequent change.
    const { data: current } = await supabase
      .from("scanner_settings")
      .select("risk_ack_high")
      .eq("user_id", userId)
      .maybeSingle();

    const { patch, warnings } = validateSettings(settingsInput, {
      currentAckHigh: (current as { risk_ack_high?: boolean } | null)?.risk_ack_high === true,
    });
    if (Object.keys(patch).length === 0) {
      const text = warnings.length
        ? `Nothing changed. ${warnings.join(" ")}`
        : "Nothing changed: no recognised settings were supplied.";
      return { content: [{ type: "text", text }], isError: true };
    }

    const { data, error } = await supabase
      .from("scanner_settings")
      .update(patch)
      .eq("user_id", userId)
      .select(
        "instruments, timeframes, sessions, min_grade, alert_min_grade, daily_setup_cap, notify_push, notify_email, account_equity, account_currency, risk_per_trade_percent, max_position_size, leverage, max_stop_loss_percent, equity_as_of, risk_ack_high",
      );

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data || data.length === 0) {
      return {
        content: [{ type: "text", text: "No settings row found for this user." }],
        isError: true,
      };
    }

    const payload = {
      updated: Object.keys(patch),
      settings: data[0],
      warnings,
      notes: {
        account_equity:
          "User-entered balance, never read from the broker. equity_as_of records when the user last set it.",
      },
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
