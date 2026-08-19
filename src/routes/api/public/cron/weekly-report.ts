/**
 * Weekly shadow-report cron. Aggregates the last 7 days of shadow_executions,
 * compares the A/A+ tier against B/C with a two-proportion z-test, and emails
 * the operator. Latched per ISO week in the database, so a retry cannot send twice.
 */
import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/cron/weekly-report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        const { adminClient } = await import("@/lib/scanner/pipeline.server");
        const { sendWeeklyReport } = await import("@/lib/reports/weekly.server");

        try {
          const result = await sendWeeklyReport(adminClient());
          return Response.json({
            ok: true,
            isoWeek: result.isoWeek,
            claimed: result.claimed,
            sent: result.sent,
            reason: result.reason ?? null,
            totalResolved: result.report.totalResolved,
            high: { resolved: result.report.high.resolved, filled: result.report.high.filled },
            low: { resolved: result.report.low.resolved, filled: result.report.low.filled },
            comparisons: result.report.comparisons.map((c) => ({
              metric: c.metric,
              verdict: c.verdict,
              pValue: c.pValue,
            })),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[cron/weekly-report] failed:", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
