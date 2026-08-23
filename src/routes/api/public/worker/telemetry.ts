/**
 * Broker account telemetry worker (Prompt 14 Stage 5).
 *
 * Standalone and bounded: it reads MetaStats account statistics and syncs Risk
 * Guardian drawdown trackers for eligible connected accounts, each under its own
 * durable server-side budget, and stores every answer as a labelled snapshot. It
 * never scans, never publishes, never grades and never touches a statistic, so a
 * slow or refusing vendor here cannot delay a scan cycle or alter a track record.
 *
 * Both passes are paid vendor reads and are therefore opt-in per account. Cost
 * control lives in the database (`claim_account_telemetry`), not here, and there
 * is no chained self-invocation: one pass per schedule tick.
 *
 * The two passes are independent: a Risk Guardian failure must not lose the
 * statistics summary, and vice versa.
 */
import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/worker/telemetry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        const { collectAccountTelemetry } = await import("@/lib/telemetry/collect.server");
        const { collectRiskGuardian } = await import("@/lib/telemetry/guardian-pass.server");
        const { TELEMETRY_ITEMS_PER_RUN } = await import("@/lib/telemetry/metastats");

        const [statistics, guardian] = await Promise.allSettled([
          collectAccountTelemetry(TELEMETRY_ITEMS_PER_RUN),
          collectRiskGuardian(),
        ]);

        const failed = [statistics, guardian].filter((r) => r.status === "rejected");
        for (const result of failed) {
          console.error("[worker/telemetry]", (result as PromiseRejectedResult).reason);
        }

        return Response.json(
          {
            ok: failed.length === 0,
            statistics:
              statistics.status === "fulfilled"
                ? statistics.value
                : { error: String((statistics as PromiseRejectedResult).reason) },
            guardian:
              guardian.status === "fulfilled"
                ? guardian.value
                : { error: String((guardian as PromiseRejectedResult).reason) },
          },
          { status: failed.length === 2 ? 500 : 200 },
        );
      },
    },
  },
});

