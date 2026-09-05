/**
 * Telemetry rollup schedule: aggregation, retention and resolver-health capacity.
 *
 * These three passes are independent on purpose. A failing retention pass must not
 * lose an aggregation, and neither may raise an error that a scheduler would retry
 * into a loop. Each reports its own outcome and each has its own kill switch.
 *
 * No provider requests are made here at all — it is pure database work.
 */
import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/cron/telemetry-rollup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const {
          runSpreadAggregation,
          runTelemetryRetention,
          recordCapacitySample,
          readResolverHealth,
        } = await import("@/lib/telemetry/workers.server");

        // Execution-quality scoring rides this pass rather than a new schedule:
        // it is pure database work over the same recorded evidence, and folding
        // it in keeps one bounded job instead of two polling ones.
        const { recomputeExecutionQuality } = await import("@/lib/execution/quality.server");

        const startedAt = Date.now();
        const [aggregation, retention, resolver, quality] = await Promise.allSettled([
          runSpreadAggregation(supabaseAdmin),
          runTelemetryRetention(supabaseAdmin),
          readResolverHealth(supabaseAdmin),
          recomputeExecutionQuality(supabaseAdmin as never),
        ]);

        const health =
          resolver.status === "fulfilled" ? resolver.value : { backlog: null, oldestAgeMs: null };

        await recordCapacitySample(supabaseAdmin, {
          source: "telemetry_rollup",
          jobDurationMs: Date.now() - startedAt,
          resolverBacklog: health.backlog,
          resolverOldestAgeMs: health.oldestAgeMs,
          details: {
            aggregation: aggregation.status === "fulfilled" ? aggregation.value : "rejected",
            retention: retention.status === "fulfilled" ? retention.value : "rejected",
            executionQuality: quality.status === "fulfilled" ? quality.value : "rejected",
          },
        });

        const rejected = [aggregation, retention, quality].filter((r) => r.status === "rejected");
        for (const r of rejected)
          console.error("[cron/telemetry-rollup]", (r as PromiseRejectedResult).reason);

        return Response.json(
          {
            ok: rejected.length === 0,
            aggregation: aggregation.status === "fulfilled" ? aggregation.value : null,
            retention: retention.status === "fulfilled" ? retention.value : null,
            executionQuality: quality.status === "fulfilled" ? quality.value : null,
            resolver: health,
          },
          { status: rejected.length === 3 ? 500 : 200 },
        );
      },
    },
  },
});
