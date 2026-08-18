/**
 * Shadow enrolment worker endpoint. Kicked by the shadow_queue insert trigger,
 * by pg_cron, or manually with the shared secret. Bounded so a single request
 * can never run long.
 */
import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

const MAX_JOBS_PER_REQUEST = 5;
const TIME_BUDGET_MS = 10_000;

export const Route = createFileRoute("/api/public/worker/shadow")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        const { adminClient } = await import("@/lib/scanner/pipeline.server");
        const { processNextShadowJob, isShadowPaused } = await import(
          "@/lib/execution/shadow_worker.server"
        );

        try {
          const db = adminClient();
          if (await isShadowPaused(db)) {
            return Response.json({ ok: true, paused: true, processed: [] });
          }

          const startedAt = Date.now();
          const processed = [];
          let budgetExhausted = false;
          for (let i = 0; i < MAX_JOBS_PER_REQUEST; i++) {
            if (Date.now() - startedAt > TIME_BUDGET_MS) {
              budgetExhausted = true;
              break;
            }
            const result = await processNextShadowJob(db);
            if (!result) break;
            processed.push(result);
          }
          return Response.json({ ok: true, processed, drained: processed.length, budgetExhausted });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[worker/shadow]", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
