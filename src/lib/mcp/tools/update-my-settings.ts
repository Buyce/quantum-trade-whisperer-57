import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { SENSITIVE_RISK_FIELDS, sensitiveFieldsIn, validateSettings } from "../settings-validation";

export interface CohortPolicyInput {
  instrument: string;
  direction: string;
  policy: string;
  risk_share_percent?: number | undefined;
}

export type UpdateMySettingsInput = Parameters<typeof sensitiveFieldsIn>[0] & {
  confirm_risk_change?: boolean | undefined;
  /** Per-instrument-and-direction automatic-order rules. Reduce-only. */
  auto_cohort_policies?: CohortPolicyInput[] | undefined;
};

/**
 * Shared body — the MCP handler and the in-app assistant call this same code.
 * Fails closed on unconfirmed sensitive risk changes; the in-app assistant adds
 * its own approval gate on top, never instead of this check.
 */
export async function runUpdateMySettings(
  supabase: unknown,
  userId: string,
  input: UpdateMySettingsInput,
) {
  const { confirm_risk_change, auto_cohort_policies, ...settingsInput } = input;
  const sensitive = sensitiveFieldsIn(settingsInput);
  const cohortRequested = Array.isArray(auto_cohort_policies) && auto_cohort_policies.length > 0;
  if (cohortRequested) sensitive.push("auto_cohort_policies" as never);
  if (sensitive.length > 0 && confirm_risk_change !== true) {
    // Fail closed and write nothing: an unconfirmed risk change is refused in
    // full, including any non-sensitive fields sent alongside it.
    return {
      content: [
        {
          type: "text" as const,
          text: `Refused: ${sensitive.join(", ")} change how much real money can be at risk. Ask the user to confirm the exact change, then retry with confirm_risk_change: true. Sensitive fields: ${SENSITIVE_RISK_FIELDS.join(", ")}.`,
        },
      ],
      isError: true,
    };
  }
  const db = supabase as ReturnType<typeof supabaseForUser>;
  // Existing acknowledgement counts: a user who already accepted high risk
  // does not have to re-acknowledge on every subsequent change.
  const { data: current } = await db
    .from("scanner_settings")
    .select("risk_ack_high, risk_per_trade_percent")
    .eq("user_id", userId)
    .maybeSingle();

  // ---- Per-cohort automatic-order rules ------------------------------------
  const cohortWarnings: string[] = [];
  const cohortApplied: string[] = [];
  if (cohortRequested) {
    const { clampCohortRiskShare, isCohortPolicyKind } = await import(
      "@/lib/delivery/cohort-policy"
    );
    const { data: existing } = await db
      .from("auto_cohort_policies")
      .select("instrument, direction, policy, risk_share_percent")
      .eq("user_id", userId);
    const before = ((existing ?? []) as CohortPolicyInput[]).map((r) => ({
      key: `${(r.instrument ?? "").toUpperCase()}:${(r.direction ?? "").toLowerCase()}`,
      policy: r.policy,
      share: r.risk_share_percent ?? 100,
    }));

    for (const raw of auto_cohort_policies ?? []) {
      const instrument = String(raw.instrument ?? "").trim().toUpperCase();
      const direction = String(raw.direction ?? "").trim().toLowerCase();
      if (!instrument || (direction !== "long" && direction !== "short")) {
        cohortWarnings.push(
          `Ignored a rule with an unusable instrument or direction: ${JSON.stringify(raw)}.`,
        );
        continue;
      }
      if (!isCohortPolicyKind(raw.policy)) {
        cohortWarnings.push(`Ignored ${instrument} ${direction}: policy must be allow, reduce or block.`);
        continue;
      }
      const key = `${instrument}:${direction}`;
      const prior = before.find((b) => b.key === key) ?? null;
      const label = `${instrument} ${direction}`;

      if (raw.policy === "allow") {
        const { error: delError } = await db
          .from("auto_cohort_policies")
          .delete()
          .eq("user_id", userId)
          .eq("instrument", instrument)
          .eq("direction", direction);
        if (delError) {
          cohortWarnings.push(`${label} was not changed: ${delError.message}`);
          continue;
        }
        cohortApplied.push(`${label}: allowed at normal risk`);
        if (prior) {
          cohortWarnings.push(
            `You removed a restriction: ${label} was ${prior.policy === "block" ? "switched off" : `limited to ${prior.share}% of normal risk`} and will now use your full per-trade risk.`,
          );
        }
        continue;
      }

      const share =
        raw.policy === "reduce" ? clampCohortRiskShare(raw.risk_share_percent ?? 50) : 100;
      const { error: upError } = await db.from("auto_cohort_policies").upsert(
        {
          user_id: userId,
          instrument,
          direction,
          policy: raw.policy,
          risk_share_percent: share,
        },
        { onConflict: "user_id,instrument,direction" },
      );
      if (upError) {
        cohortWarnings.push(`${label} was not changed: ${upError.message}`);
        continue;
      }
      cohortApplied.push(
        raw.policy === "block" ? `${label}: automatic orders off` : `${label}: ${share}% of normal risk`,
      );
      if (raw.policy === "reduce" && prior && prior.policy === "block") {
        cohortWarnings.push(
          `You loosened a restriction: ${label} was switched off and will now trade at ${share}% of your normal risk.`,
        );
      } else if (raw.policy === "reduce" && prior?.policy === "reduce" && share > prior.share) {
        cohortWarnings.push(
          `You raised the risk share on ${label} from ${prior.share}% to ${share}% of normal.`,
        );
      }
    }
  }

  const { patch, warnings } = validateSettings(settingsInput, {
    currentAckHigh: (current as { risk_ack_high?: boolean } | null)?.risk_ack_high === true,
    currentRiskPercent:
      (current as { risk_per_trade_percent?: number } | null)?.risk_per_trade_percent ?? null,
  });
  if (Object.keys(patch).length === 0 && cohortApplied.length > 0) {
    const payload = {
      updated: ["auto_cohort_policies"],
      auto_cohort_policies: cohortApplied,
      warnings: [...warnings, ...cohortWarnings],
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  }
  if (Object.keys(patch).length === 0) {
    const text = warnings.length
      ? `Nothing changed. ${warnings.join(" ")}`
      : "Nothing changed: no recognised settings were supplied.";
    return { content: [{ type: "text" as const, text }], isError: true };
  }

  const { data, error } = await db
    .from("scanner_settings")
    .update(patch)
    .eq("user_id", userId)
    .select(
      "instruments, sessions, min_grade, alert_min_grade, daily_setup_cap, notify_push, notify_email, account_equity, account_currency, risk_per_trade_percent, max_position_size, leverage, max_stop_loss_percent, equity_as_of, risk_ack_high, maximum_concurrent_signal_orders, maximum_daily_signal_orders, maximum_daily_orders_per_symbol, auto_order_window_minutes, adaptive_order_ceilings_enabled, adaptive_order_ceiling_max, adaptive_order_ceiling_floor, auto_market_entry_enabled, auto_execute_c_grade, auto_intel_gate_enabled, auto_intel_min_win_pct, auto_intel_min_sample, auto_intel_min_expected_r, allow_unmeasured_intel, max_entry_spread_pips, max_entry_slippage_pips, exposure_limit_enabled, max_total_exposure_percent, drawdown_brakes_enabled, daily_loss_limit_percent, weekly_loss_limit_percent, consecutive_loss_limit, consecutive_loss_pause_hours, max_drawdown_percent, max_same_bet_orders, same_bet_cooldown_minutes",
    );

  if (error) return { content: [{ type: "text" as const, text: error.message }], isError: true };
  if (!data || data.length === 0) {
    return {
      content: [{ type: "text" as const, text: "No settings row found for this user." }],
      isError: true,
    };
  }

  const payload = {
    updated: [...Object.keys(patch), ...(cohortApplied.length ? ["auto_cohort_policies"] : [])],
    settings: data[0],
    auto_cohort_policies: cohortApplied,
    warnings: [...warnings, ...cohortWarnings],
    notes: {
      account_equity:
        "User-entered balance, never read from the broker. equity_as_of records when the user last set it.",
    },
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

export default defineTool({
  name: "update_my_settings",
  title: "Update my settings",
  description:
    "Change the signed-in user's own feed filters, alert grade, daily cap (0 = unlimited; the cap governs feed and alert eligibility, each channel using its own grade threshold), notification preferences and risk profile. Only the fields you pass are changed; values outside safe bounds are clamped and reported back. Webhook URL and secret cannot be changed by an agent. It also changes the automatic-order rules (ceilings, order window, adaptive ceilings, market-entry mode), the gates (C-Grade permission, intelligence gate, spread and slippage caps, exposure limit) and the risk brakes (daily and weekly closed-loss limits, losing-run limit and pause length, peak-equity drawdown, same-bet limit and same-bet cool-off). Any field that changes how much real money can be at risk — the risk profile, a ceiling, a gate or a brake — additionally requires confirm_risk_change: true, which asserts the user explicitly approved that exact change in this conversation; never set it on your own initiative. Warnings are returned verbatim and must be repeated to the user, especially when a same-bet limit is raised or a cool-off is switched off.",
  inputSchema: {
    instruments: z
      .array(z.string())
      .optional()
      .describe(
        "Subset of the instruments P-Trades defines. Unknown values are ignored and reported back; an instrument that has not been promoted yet is legal to select but simply never produces setups.",
      ),
    // Kept in the schema only so an older agent gets an explanation instead of
    // a schema error; the validator refuses it and never writes the column.
    timeframes: z
      .array(z.string())
      .optional()
      .describe(
        "Deprecated and ignored: every setup covers H4, H1 and M15 together, so timeframes are not a filter. Do not send.",
      ),
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
    // ---- Automatic-order rules: throughput only, never permission ----
    maximum_concurrent_signal_orders: z
      .number()
      .optional()
      .describe("Ceiling on automatic orders unresolved at once (0-100). Never a quota."),
    maximum_daily_signal_orders: z
      .number()
      .optional()
      .describe("Ceiling on automatic orders created per UTC day (0-100)."),
    maximum_daily_orders_per_symbol: z
      .number()
      .optional()
      .describe("Ceiling on automatic orders for ONE instrument per UTC day (0-100)."),
    auto_order_window_minutes: z
      .number()
      .optional()
      .describe(
        "How long after detection a published setup may still become an automatic order, in minutes (0-600). 0 disables automatic orders on age grounds.",
      ),
    adaptive_order_ceilings_enabled: z
      .boolean()
      .optional()
      .describe("Move the effective daily and per-instrument ceilings with broker data freshness."),
    adaptive_order_ceiling_max: z
      .number()
      .optional()
      .describe("Upper bound adaptive mode may raise a ceiling to (0-100)."),
    adaptive_order_ceiling_floor: z
      .number()
      .optional()
      .describe("Lower bound adaptive mode reduces to when freshness is degraded or unknown."),
    auto_market_entry_enabled: z
      .boolean()
      .optional()
      .describe(
        "Submit an eligible order immediately at market while the live price is still within the maximum acceptable entry. It never widens the slippage ceiling.",
      ),

    // ---- Gates: each one only ever refuses ----
    auto_execute_c_grade: z
      .boolean()
      .optional()
      .describe("Allow C-Grade setups to become automatic orders. Every other gate still applies."),
    auto_intel_gate_enabled: z
      .boolean()
      .optional()
      .describe("Switch the intelligence gate on/off."),
    auto_intel_min_win_pct: z
      .number()
      .optional()
      .describe("Minimum measured win-if-filled rate for the regime, in percent (0-100)."),
    auto_intel_min_sample: z
      .number()
      .optional()
      .describe("Minimum resolved replay samples before the gate will judge a regime."),
    auto_intel_min_expected_r: z
      .number()
      .optional()
      .describe(
        "Minimum measured expected return in R for the pair and direction (-5 to 5). Descriptive in-sample measurement, not a forecast.",
      ),
    allow_unmeasured_intel: z
      .boolean()
      .optional()
      .describe("Let a regime with too few resolved samples through the gate."),
    max_entry_spread_pips: z
      .number()
      .optional()
      .describe("Hard pre-send cap on live spread at entry, in pips. 0 disables the check."),
    max_entry_slippage_pips: z
      .number()
      .optional()
      .describe("Maximum tolerated slippage versus the published entry, in pips. 0 disables."),
    exposure_limit_enabled: z
      .boolean()
      .optional()
      .describe("Enforce the total open-exposure ceiling."),
    max_total_exposure_percent: z
      .number()
      .optional()
      .describe("Ceiling on total open signal exposure as a percent of equity (0-100)."),

    // ---- Brakes: measured from closed broker trades only ----
    drawdown_brakes_enabled: z
      .boolean()
      .optional()
      .describe("Master switch for the risk brakes. False disables all of them at once."),
    daily_loss_limit_percent: z
      .number()
      .optional()
      .describe("Closed loss since 00:00 UTC as a percent of broker equity. 0 disables."),
    weekly_loss_limit_percent: z
      .number()
      .optional()
      .describe("Closed loss since Monday 00:00 UTC as a percent of broker equity. 0 disables."),
    consecutive_loss_limit: z
      .number()
      .optional()
      .describe("Losing closed broker trades in a row that trigger a hold. 0 disables."),
    consecutive_loss_pause_hours: z
      .number()
      .nullable()
      .optional()
      .describe("How long a losing-run hold lasts: 3, 5, or null for until the next UTC midnight."),
    max_drawdown_percent: z
      .number()
      .optional()
      .describe("Equity drop from the highest observed equity, in percent. 0 disables."),
    max_same_bet_orders: z
      .number()
      .optional()
      .describe(
        "How many unresolved automatic orders may be live on the same instrument in the same direction (1-3, default 1). Several separate setups on the same pair and side are ONE bet: raising this multiplies the risk sized per trade, and the tool warns every time it is raised.",
      ),
    same_bet_cooldown_minutes: z
      .number()
      .optional()
      .describe(
        "How long new automatic orders on the same instrument and direction are refused after a broker-confirmed loss there: 0 (off), 30, 60 or 120 minutes.",
      ),

    auto_cohort_policies: z
      .array(
        z.object({
          instrument: z.string(),
          direction: z.enum(["long", "short"]),
          policy: z.enum(["allow", "reduce", "block"]),
          risk_share_percent: z
            .number()
            .optional()
            .describe("Share of the user's normal per-trade risk when policy = reduce (1-100)."),
        }),
      )
      .optional()
      .describe(
        "Per-instrument AND direction automatic-order rules, for example EURUSD short. block refuses automatic orders on that pair and side; reduce places them with risk_share_percent of the user's normal per-trade risk; allow clears the rule. Reduce-only: it never causes an order, never enlarges one, and never changes the feed, alerts, publication, grading, replay or any statistic. Requires confirm_risk_change: true, and any loosening is reported back as a warning that must be repeated to the user.",
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
    return runUpdateMySettings(supabaseForUser(ctx), ctx.getUserId() as string, input);
  },
});
