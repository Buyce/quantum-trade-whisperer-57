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

export const Route = createFileRoute("/api/public/worker/process")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        const { adminClient, processNextJob } = await import("@/lib/scanner/pipeline.server");
        try {
          const db = adminClient();
          const processed = [];
          for (let i = 0; i < MAX_JOBS_PER_REQUEST; i++) {
            const result = await processNextJob(db);
            if (!result) break;
            processed.push(result);
          }
          return Response.json({ ok: true, processed, drained: processed.length });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[worker/process]", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
