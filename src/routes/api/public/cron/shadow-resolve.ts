/**
 * Hourly shadow resolution cron. Reclaims stale enrolment jobs, then replays
 * every open shadow row against fresh M15 candles. Never touches live user
 * data or the live scan path.
 */
import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/cron/shadow-resolve")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        const { adminClient } = await import("@/lib/scanner/pipeline.server");
        const { isShadowPaused, noteShadowRun } = await import(
          "@/lib/execution/shadow_worker.server"
        );
        const { resolveShadowExecutions } = await import("@/lib/execution/shadow_resolve.server");

        const db = adminClient();
        try {
          if (await isShadowPaused(db)) {
            return Response.json({ ok: true, paused: true });
          }

          const { data: maintenance } = await db.rpc("maintain_shadow_queue");
          const summary = await resolveShadowExecutions(db);

          // Every instrument failing to return candles is a source-level
          // problem; that increments the breaker. A partial failure is normal.
          const allFailed =
            summary.instruments.length > 0 && summary.fetchFailures === summary.instruments.length;
          await noteShadowRun(db, {
            failure: allFailed,
            error: allFailed ? "All instrument candle fetches failed" : null,
          });

          return Response.json({ ok: true, maintenance, ...summary });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[cron/shadow-resolve]", message);
          await noteShadowRun(db, { failure: true, error: message });
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
