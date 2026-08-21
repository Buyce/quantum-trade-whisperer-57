import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

/**
 * The shadow tables are service-role gated, so the aggregation runs with the
 * admin client — but only AFTER the caller's OAuth token is verified, and it
 * returns aggregates exclusively: no per-user rows, no PII, nothing that a
 * signed-in user could not already see on the performance page.
 */
export default defineTool({
  name: "get_shadow_comparison",
  title: "Get shadow engine comparison",
  description:
    "Compare the deterministic shadow-replay performance of high-grade setups (A+/A) against lower grades (B/C) over the last 7 days: fill rate, win rate, mean and total R, expectancy, sample sizes, and the statistical significance of each difference. Empty tiers report zeroes rather than estimates.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    // Confirms the token really resolves to a user under row security before
    // any admin-client read runs.
    const probe = await supabaseForUser(ctx).from("regime_stats").select("tier").limit(1);
    if (probe.error) return { content: [{ type: "text", text: probe.error.message }], isError: true };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadWeeklyReport } = await import("@/lib/reports/weekly.server");
    const report = await loadWeeklyReport(supabaseAdmin);

    const payload = {
      iso_week: report.isoWeek,
      window_start: report.windowStart,
      window_end: report.windowEnd,
      total_resolved: report.totalResolved,
      high_grade: report.high,
      low_grade: report.low,
      comparisons: report.comparisons,
      note:
        report.totalResolved === 0
          ? "No shadow samples resolved in this window — the comparison is genuinely empty."
          : "Shadow replay outcomes are deterministic barrier replays, not user-reported results.",
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
