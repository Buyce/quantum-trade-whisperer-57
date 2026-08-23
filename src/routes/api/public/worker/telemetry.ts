/**
 * Broker account telemetry worker (Prompt 14 Stage 5).
 *
 * Standalone and bounded: it reads MetaStats account statistics for eligible
 * connected accounts under a durable server-side budget, and stores each answer
 * as a labelled snapshot. It never scans, never publishes, never grades and never
 * touches a statistic, so a slow or refusing vendor here cannot delay a scan
 * cycle or alter a track record.
 *
 * Cost control lives in the database (`claim_account_telemetry`), not here, and
 * there is no chained self-invocation: one pass per schedule tick.
 */
import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/worker/telemetry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        const { collectAccountTelemetry } = await import("@/lib/telemetry/collect.server");
        const { TELEMETRY_ITEMS_PER_RUN } = await import("@/lib/telemetry/metastats");

        try {
          const summary = await collectAccountTelemetry(TELEMETRY_ITEMS_PER_RUN);
          return Response.json({ ok: true, ...summary });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[worker/telemetry]", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
