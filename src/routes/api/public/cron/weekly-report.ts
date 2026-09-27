/**
 * End-of-trading-week report endpoint. Aggregates the last 7 days of shadow_executions,
 * compares A/A+ against B/C with dependence-aware day-cluster intervals, and
 * emails the operator. Latched per ISO week so a retry cannot send twice.
 *
 * The versioned scheduler invokes this after the trading week and maturity
 * horizon. The database latch remains authoritative if the scheduler retries.
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
