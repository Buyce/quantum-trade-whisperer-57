/**
 * Scheduled economic-event ingestion (FRED only).
 *
 * FRED is the only currently authorized provider. There is deliberately no
 * energy provider: the owner holds no valid EIA credential and OPEC publishes no
 * machine-readable feed, so energy coverage stays honestly `unavailable` /
 * `unknown` and USOIL / UKOIL fail closed wherever energy news coverage is
 * required. The provider interface stays provider-neutral so a future authorized
 * provider plugs in without changing this route's contract.
 *
 * Bounded by construction: one provider, one window, one ledger row. The route
 * ingests and measures coverage. It never grades, publishes, alerts, enqueues or
 * submits anything to a broker, and it never enforces news suppression:
 * enforcement is a separate, per-instrument decision.
 */
import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

/** Forward window for schedules. */
const FORWARD_DAYS = 30;

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export const Route = createFileRoute("/api/public/cron/ingest-news")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runNewsIngestion } = await import("@/lib/news/ingest.server");
        const { createFredProvider } = await import("@/lib/news/providers/fred.server");
        const { allRegistryScopes } = await import("@/lib/news/scopes");

        const nowMs = Date.now();
        const scopes = allRegistryScopes();

        try {
          const results = [
            // FRED: forward release schedule, date-only precision.
            await runNewsIngestion({
              db: supabaseAdmin,
              provider: createFredProvider(),
              job: "fred_release_schedule",
              from: isoDate(nowMs - 2 * 86_400_000),
              to: isoDate(nowMs + FORWARD_DAYS * 86_400_000),
              scopes,
              nowMs,
            }),
          ];

          return Response.json({ ok: true, results });
        } catch (err) {
          console.error("[cron/ingest-news]", err);
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          );
        }
      },
    },
  },
});
