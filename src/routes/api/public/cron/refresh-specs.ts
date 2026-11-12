/**
 * Broker contract-specification refresh cron (daily).
 *
 * Separate from /api/public/cron/scan on purpose: the scan cron must stay a
 * lightweight enqueue-and-return, and broker specification requests must never
 * be able to delay, fail or repeat a scan cycle. The per-symbol attempt budget
 * is durable, so running this endpoint more often than daily still issues at
 * most one MetaApi specification request per symbol per 24 hours.
 *
 * The symbol list is the instruments this cycle would actually scan
 * (`scanUniverse`), NOT the frozen Wave 0 list. The scan universe is
 * lifecycle-driven and reaches past Wave 0, and an instrument whose broker name
 * was last confirmed more than 36h ago is refused by the mapping layer as
 * `verification_stale` — so refreshing only Wave 0 left every Wave 1+ instrument
 * permanently unusable no matter how many cycles ran.
 */
import { describeError } from "@/lib/errors/describe";
import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/cron/refresh-specs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();
        try {
          const { adminClient, scanUniverse } = await import("@/lib/scanner/pipeline.server");
          const { refreshSymbolSpecs } = await import("@/lib/broker/specs.server");
          const db = adminClient();

          /**
           * Refresh exactly what the scanner is allowed to analyse. If the
           * lifecycle read fails, `scanUniverse` itself falls back to the frozen
           * Wave 0 list; if the call throws outright we still refresh Wave 0
           * rather than skip the day's broker re-verification entirely.
           */
          let symbols: string[];
          try {
            symbols = await scanUniverse(db);
          } catch {
            const { INSTRUMENTS } = await import("@/lib/scanner/types");
            symbols = [...INSTRUMENTS];
          }

          const specs = await refreshSymbolSpecs(db, Date.now(), symbols);
          return Response.json({ ok: true, specs });
        } catch (err) {
          const message = describeError(err);
          console.error("[cron/refresh-specs]", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
