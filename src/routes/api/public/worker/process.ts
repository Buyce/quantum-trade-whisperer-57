/**
 * Queue worker. Processes ONE instrument per pass and chains to the next job,
 * with a small per-request budget so no single invocation runs long.
 *
 * Triggered automatically by the scan_queue insert trigger, by pg_cron, or
 * manually with the shared secret.
 */
import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

const MAX_JOBS_PER_REQUEST = 3;
/**
 * Wall-clock budget. A job can spend up to 3 × 8s on candle fetches alone, so a
 * count-only bound could push one request past the platform timeout — which is
 * exactly how jobs used to get abandoned mid-write. We stop starting new jobs
 * once the budget is spent and let the next pass drain the rest.
 */
const TIME_BUDGET_MS = 20_000;

export const Route = createFileRoute("/api/public/worker/process")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        const { adminClient, processNextJob } = await import("@/lib/scanner/pipeline.server");
        try {
          const db = adminClient();
          const startedAt = Date.now();
          const processed = [];
          let budgetExhausted = false;
          for (let i = 0; i < MAX_JOBS_PER_REQUEST; i++) {
            if (Date.now() - startedAt > TIME_BUDGET_MS) {
              budgetExhausted = true;
              break;
            }
            const result = await processNextJob(db);
            if (!result) break;
            processed.push(result);
          }
          return Response.json({ ok: true, processed, drained: processed.length, budgetExhausted });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[worker/process]", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
