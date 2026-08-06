/**
 * pg_cron entry point (every 15 minutes).
 *
 * Deliberately lightweight: it only enqueues one job per monitored instrument
 * and returns. All fetching/grading happens in the worker chain, so this
 * request never risks a timeout.
 */
import { createFileRoute } from "@tanstack/react-router";

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

export const Route = createFileRoute("/api/public/cron/scan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorize(request)) return unauthorized();

        const { adminClient, enqueueScanCycle } = await import("@/lib/scanner/pipeline.server");
        try {
          const db = adminClient();
          const result = await enqueueScanCycle(db);
          return Response.json({ ok: true, ...result });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[cron/scan]", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
