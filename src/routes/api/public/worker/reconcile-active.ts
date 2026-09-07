/**
 * Active-signal execution reconciler worker.
 *
 * Bounded, authenticated with the shared cron secret, and separate from both the
 * scan worker and the delivery dispatcher: a slow reconciliation pass can never
 * delay a scan, a publication or a statistic.
 *
 * This route creates queued deliveries through the authoritative enqueue path.
 * The dispatcher, not this route, submits orders after its own pre-send
 * revalidation.
 *
 * It then runs the managed-exit pass, which is the ONE place P-Trades acts on an
 * already-filled position: on DEMO accounts running the managed policy, it closes
 * part of the position at the first target and moves the remaining stop to
 * break-even. Every action is recorded before it is attempted and only marked
 * confirmed on a definite broker acceptance.
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
          const db = adminClient();
          const outcome = await reconcileActiveSignals(db);
          // Managed exits run after enqueueing and cannot affect it: a failure here
          // is reported, never allowed to mask the reconciliation result.
          let managed = null;
          try {
            const { manageDemoPositions } = await import("@/lib/delivery/manage-positions.server");
            managed = await manageDemoPositions(db);
          } catch (err) {
            console.error(
              "[worker/reconcile-active] managed exits",
              err instanceof Error ? err.message : String(err),
            );
          }
          return Response.json({ ok: true, ...outcome, managedExits: managed });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[worker/reconcile-active]", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
