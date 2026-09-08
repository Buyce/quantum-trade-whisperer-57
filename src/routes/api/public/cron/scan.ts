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

          // Health notice only, and strictly non-throwing: if the previous cycles
          // were discarded before any candle read, the queue looks busy while the
          // strategy analysed nothing, so the owner is told once per incident.
          const { runStarvationWatch } = await import("@/lib/scanner/starvation-watch.server");
          const starvation = await runStarvationWatch(db);

          // Broker contract specifications are refreshed by their own daily cron
          // (/api/public/cron/refresh-specs). They are deliberately NOT touched
          // here: this endpoint must stay a lightweight enqueue-and-return.
          return Response.json({ ok: true, ...result, starvation });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[cron/scan]", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
