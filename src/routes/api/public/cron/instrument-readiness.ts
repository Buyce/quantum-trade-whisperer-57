/**
 * Instrument readiness snapshot trigger.
 *
 * DELIBERATELY NOT ON A FREQUENT SCHEDULE. A readiness check fetches three candle
 * series, a quote and the conversion legs for one instrument — an order of
 * magnitude more provider work than a spread sample. It runs when an operator asks
 * for evidence, or at most daily, and it is kill-switched like every other worker.
 *
 * It writes evidence. It never promotes, demotes or enables anything.
 */
import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/cron/instrument-readiness")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { readTelemetryControls } = await import("@/lib/telemetry/controls.server");
        const { snapshotInstrumentReadiness } = await import(
          "@/lib/instruments/readiness-snapshot.server"
        );
        const { fetchQuote } = await import("@/lib/metaapi/market.server");

        const controls = await readTelemetryControls(supabaseAdmin);
        if (controls.degraded || !controls.readinessEnabled) {
          return Response.json({
            ok: true,
            ran: false,
            reason: controls.degraded ? "controls_unreadable" : "disabled",
          });
        }

        // Scope is the authorised sampler set: readiness is only ever proven for
        // instruments this deployment is already allowed to read.
        const symbols = controls.samplerSymbols.slice(0, controls.maxInstrumentsPerRun);
        const results = [];
        for (const symbol of symbols) {
          try {
            results.push(await snapshotInstrumentReadiness(supabaseAdmin, symbol, fetchQuote));
          } catch (err) {
            console.error("[cron/instrument-readiness]", symbol, err);
            results.push({
              instrument: symbol,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        return Response.json({ ok: true, ran: true, results });
      },
    },
  },
});
