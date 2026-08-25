/**
 * Scheduled economic-event ingestion (FRED + EIA).
 *
 * Bounded by construction: two providers, one window each, one ledger row each.
 * Providers are independent — an EIA credential failure must not stop FRED from
 * proving USD schedule coverage — and each has its own breaker derived from the
 * run ledger.
 *
 * This route ingests and measures coverage. It never grades, publishes, alerts,
 * enqueues or submits anything to a broker, and it never enforces news
 * suppression: enforcement is a separate, per-instrument decision.
 */
import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

/** Forward window for schedules, backward window for published values. */
const FORWARD_DAYS = 30;
const BACKWARD_DAYS = 45;

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
        const { createEiaProvider } = await import("@/lib/news/providers/eia.server");
        const { allRegistryScopes } = await import("@/lib/news/scopes");

        const nowMs = Date.now();
        const scopes = allRegistryScopes();

        try {
          const results = [];

          // FRED: forward release schedule.
          results.push(
            await runNewsIngestion({
              db: supabaseAdmin,
              provider: createFredProvider(),
              job: "fred_release_schedule",
              from: isoDate(nowMs - 2 * 86_400_000),
              to: isoDate(nowMs + FORWARD_DAYS * 86_400_000),
              scopes,
              nowMs,
            }),
          );

          // EIA: published weekly values (no forward schedule exists).
          results.push(
            await runNewsIngestion({
              db: supabaseAdmin,
              provider: createEiaProvider(),
              job: "eia_weekly_stocks",
              from: isoDate(nowMs - BACKWARD_DAYS * 86_400_000),
              to: isoDate(nowMs),
              scopes,
              nowMs: Date.now(),
            }),
          );

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
