/**
 * Queue worker. Processes ONE instrument per pass and chains to the next job,
 * with a small per-request budget so no single invocation runs long.
 *
 * Triggered automatically by the scan_queue insert trigger, by pg_cron, or
 * manually with the shared secret.
 */
import { createFileRoute } from "@tanstack/react-router";

const MAX_JOBS_PER_REQUEST = 3;

function unauthorized() {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function authorize(request: Request): boolean {
  const secret = process.env["CRON_SECRET"];
  if (!secret) return false;
  const header =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (header.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= header.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/worker/process")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorize(request)) return unauthorized();

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
