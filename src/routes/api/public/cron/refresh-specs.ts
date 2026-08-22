/**
 * Broker contract-specification refresh cron (daily).
 *
 * Separate from /api/public/cron/scan on purpose: the scan cron must stay a
 * lightweight enqueue-and-return, and broker specification requests must never
 * be able to delay, fail or repeat a scan cycle. The per-symbol attempt budget
 * is durable, so running this endpoint more often than daily still issues at
 * most one MetaApi specification request per symbol per 24 hours.
 */
import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/cron/refresh-specs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();
        try {
          const { adminClient } = await import("@/lib/scanner/pipeline.server");
          const { refreshSymbolSpecs } = await import("@/lib/broker/specs.server");
          const specs = await refreshSymbolSpecs(adminClient());
          return Response.json({ ok: true, specs });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[cron/refresh-specs]", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
