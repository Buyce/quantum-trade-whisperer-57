/**
 * Bounded spread-sampler schedule (Wave 0 only).
 *
 * One quote per authorised instrument per 15-minute UTC slot. The endpoint is a
 * trigger, nothing more: the kill switch, the slot claim and the per-run ceilings
 * all live below it, so calling this route twice cannot sample twice.
 *
 * It never grades, publishes, alerts or executes.
 */
import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/cron/sample-spreads")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runSpreadSampler } = await import("@/lib/telemetry/sampler.server");
        const { recordCapacitySample } = await import("@/lib/telemetry/workers.server");

        try {
          const outcome = await runSpreadSampler(supabaseAdmin);
          if (outcome.ran) {
            await recordCapacitySample(supabaseAdmin, {
              source: "spread_sampler",
              runId: outcome.runId ?? null,
              jobDurationMs: outcome.durationMs ?? null,
              providerRequests: outcome.requestCount ?? 0,
              quoteFailures: outcome.failedRequests ?? 0,
              details: {
                expected: outcome.expected ?? [],
                succeeded: outcome.succeeded ?? [],
                stage_skipped: outcome.stageSkipped ?? [],
                breaker_skipped: outcome.breakerSkipped ?? [],
                mapping_refused: outcome.mappingRefused ?? [],
                invalid_samples: outcome.invalidSamples ?? 0,
              },
            });
          }
          return Response.json({ ok: true, ...outcome });
        } catch (err) {
          console.error("[cron/sample-spreads]", err);
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          );
        }
      },
    },
  },
});
