/**
 * Scheduled economic-event ingestion — currently NO authorized provider.
 *
 * FRED was retired as a calendar provider: it publishes release dates without an
 * exact intraday release time, covers almost nothing outside USD, and therefore
 * could never authorise an intraday suppression. Rather than keep a feed running
 * that can only ever produce `timestamp_incomplete` coverage, the provider is
 * gone and this route ingests nothing.
 *
 * The provider-neutral contract in `@/lib/news/types` and the ingestion runtime
 * in `@/lib/news/ingest.server` are untouched, so a licensed calendar with exact
 * times plugs in here without changing this route's shape.
 *
 * Honest by construction: an absent provider writes NO events and NO coverage
 * rows. Missing data never becomes "clear".
 */
import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

export const NEWS_PROVIDERS_CONFIGURED: readonly string[] = [];

export const Route = createFileRoute("/api/public/cron/ingest-news")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        return Response.json({
          ok: true,
          providers: NEWS_PROVIDERS_CONFIGURED,
          results: [],
          note: "No authorized economic-calendar provider is configured. Nothing was ingested and no coverage was claimed.",
        });
      },
    },
  },
});
