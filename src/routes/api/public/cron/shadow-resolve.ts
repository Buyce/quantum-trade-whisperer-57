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

          // Statistics rebuild runs last and is guarded separately: a failure
          // here must never re-label a successful resolution pass as failed.
          let stats: unknown = null;
          let statsError: string | null = null;
          let milestones: unknown = null;
          try {
            const { data, error } = await db.rpc("recompute_regime_stats");
            if (error) throw new Error(error.message);
            stats = data;

            // Operator notification when the dataset first clears an activation
            // gate. Latched in the database, so it sends exactly once per gate.
            const { notifyLearningMilestones } = await import("@/lib/learning/milestone.server");
            milestones = await notifyLearningMilestones(db, data as never);
          } catch (statsErr) {
            statsError = statsErr instanceof Error ? statsErr.message : String(statsErr);
            console.error("[cron/shadow-resolve] regime stats recompute failed:", statsError);
          }

          // Every instrument failing to return candles is a source-level
          // problem; that increments the breaker. A partial failure is normal.
          const allFailed =
            summary.instruments.length > 0 && summary.fetchFailures === summary.instruments.length;
          await noteShadowRun(db, {
            failure: allFailed,
            error: allFailed ? "All instrument candle fetches failed" : null,
          });

          return Response.json({
            ok: true,
            maintenance,
            stats,
            statsError,
            milestones,
            ...summary,
          });
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
