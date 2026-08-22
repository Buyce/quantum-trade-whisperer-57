/**
 * pg_cron entry point (every 15 minutes).
 *
 * Deliberately lightweight: it only enqueues one job per monitored instrument
 * and returns. All fetching/grading happens in the worker chain, so this
 * request never risks a timeout.
 */
import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/cron/scan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        const { adminClient, enqueueScanCycle } = await import("@/lib/scanner/pipeline.server");
        try {
          const db = adminClient();
          const result = await enqueueScanCycle(db);

          // Broker contract specs: at most one request per symbol per 24h, and
          // deliberately AFTER enqueueing so it can never delay or fail a scan.
          let specs: unknown = null;
          try {
            const { refreshSymbolSpecs } = await import("@/lib/broker/specs.server");
            specs = await refreshSymbolSpecs(db);
          } catch (err) {
            console.error("[cron/scan] spec refresh failed", err);
          }

          return Response.json({ ok: true, ...result, specs });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[cron/scan]", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
