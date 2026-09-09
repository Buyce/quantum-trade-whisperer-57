/**
 * Scheduled market-context ingestion.
 *
 * Pulls intermarket series (FRED), the volatility regime (CBOE VIX) and weekly
 * futures positioning (CFTC). Context is recorded for measurement only — it does
 * not refuse, resize or reorder any order today.
 *
 * Every attempt writes a ledger row, including failures, so an empty context
 * table can always be told apart from a quiet market.
 */
import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";
import { runMarketContextIngestion } from "@/lib/context/fetch.server";

export const Route = createFileRoute("/api/public/cron/ingest-market-context")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const results = await runMarketContextIngestion(supabaseAdmin, Date.now());

        return Response.json({
          ok: results.every((r) => r.status === "ok" || r.status === "empty"),
          results,
          note: "Market context is recorded for measurement only. It does not gate orders.",
        });
      },
    },
  },
});
