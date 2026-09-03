/**
 * Hourly shadow resolution cron. Reclaims stale enrolment jobs, then replays
 * every open shadow row against fresh M15 candles. Never touches live user
 * data or the live scan path.
 */
import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";
import { ACTIVE_MODEL_VERSION } from "@/lib/versioning";

export const Route = createFileRoute("/api/public/cron/shadow-resolve")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        const { adminClient } = await import("@/lib/scanner/pipeline.server");
        const { shadowBreakerGate, noteShadowRun } =
          await import("@/lib/execution/shadow_worker.server");
        const { allFetchesFailedMessage, resolveShadowExecutions } =
          await import("@/lib/execution/shadow_resolve.server");

        const db = adminClient();
        let probe = false;
        try {
          const gate = await shadowBreakerGate(db);
          if (!gate.allowed) {
            return Response.json({
              ok: true,
              paused: true,
              paused_until: gate.pausedUntil,
              consecutive_failures: gate.consecutiveFailures,
            });
          }
          // Single probe pass through a still-tripped breaker: a clean pass
          // clears it, a failed one extends the cooldown (see noteShadowRun).
          probe = gate.probe;

          const { data: maintenance } = await db.rpc("maintain_shadow_queue");
          const summary = await resolveShadowExecutions(db);

          /**
           * Stage 4 — research-candidate enrolment. Runs AFTER production
           * resolution, is bounded by `candidate_rows_per_run`, and is gated by
           * `candidate_enrolment_enabled` (false in production: this is one flag
           * read and a zeroed summary). Its own try/catch: a research failure can
           * never re-label a successful production resolve pass as failed.
           */
          let candidateEnrolment: unknown = null;
          try {
            const { enrolPendingCandidates } =
              await import("@/lib/research/enrol-candidates.server");
            candidateEnrolment = await enrolPendingCandidates(db);
          } catch (enrolErr) {
            console.error(
              "[cron/shadow-resolve] candidate enrolment failed:",
              enrolErr instanceof Error ? enrolErr.message : String(enrolErr),
            );
          }

          /**
           * Filter lift — the only place the rejected arm becomes evidence.
           * Runs after candidate resolution so it reads the freshest research
           * outcomes, is scoped by the function itself to the research cohort,
           * and is guarded separately: a lift failure must never re-label a
           * successful production resolve pass as failed.
           */
          let filterLift: unknown = null;
          let filterLiftError: string | null = null;
          try {
            const { data, error } = await db.rpc("recompute_filter_lift", {
              _horizon_hours: 24,
            });
            if (error) throw new Error(error.message);
            filterLift = data;
          } catch (liftErr) {
            filterLiftError = liftErr instanceof Error ? liftErr.message : String(liftErr);
            console.error("[cron/shadow-resolve] filter lift recompute failed:", filterLiftError);
            try {
              const { noteResearchFailure } = await import("@/lib/research/observations.server");
              await noteResearchFailure(db, `filter lift recompute failed: ${filterLiftError}`);
            } catch {
              // Research health is best-effort; production resolution stands.
            }
          }


          // Statistics rebuild runs last and is guarded separately: a failure
          // here must never re-label a successful resolution pass as failed.
          let stats: unknown = null;
          let statsError: string | null = null;
          let milestones: unknown = null;
          try {
            // Explicitly pinned to the production model. Research cohorts
            // (V2/V3) must never contribute to the live priors, so the version
            // is passed rather than left to the function's default.
            const { data, error } = await db.rpc("recompute_regime_stats", {
              _model_version: ACTIVE_MODEL_VERSION,
            });
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

          // Every attempted provider fetch failing is a source-level problem;
          // lifecycle/mapping refusals are truthful skips, not provider outages.
          const allFailedMessage = allFetchesFailedMessage(summary);
          await noteShadowRun(db, {
            failure: allFailedMessage !== null,
            error: allFailedMessage,
          });

          return Response.json({
            ok: true,
            probe,
            breaker_cleared: probe && allFailedMessage === null,
            maintenance,
            stats,
            statsError,
            milestones,
            candidateEnrolment,
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
