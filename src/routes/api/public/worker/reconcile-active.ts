/**
 * Active-signal execution reconciler worker.
 *
 * Bounded, authenticated with the shared cron secret, and separate from both the
 * scan worker and the delivery dispatcher: a slow reconciliation pass can never
 * delay a scan, a publication or a statistic.
 *
 * This route only ever creates queued deliveries through the authoritative
 * enqueue path. It sends nothing to a broker — the dispatcher does that, after
 * its own pre-send revalidation.
 */
import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/worker/reconcile-active")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        const { adminClient } = await import("@/lib/scanner/pipeline.server");
        const { reconcileActiveSignals } = await import("@/lib/delivery/reconcile-active.server");

        try {
          const outcome = await reconcileActiveSignals(adminClient());
          return Response.json({ ok: true, ...outcome });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[worker/reconcile-active]", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
