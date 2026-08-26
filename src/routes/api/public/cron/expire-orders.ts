/**
 * Unfilled-order sweeper schedule.
 *
 * Bounded, cron-authenticated, and independent of dispatch: clearing stale slots
 * must never delay a scan, a publication or a statistic. Every pass examines at
 * most `MAX_EXPIRIES_PER_RUN` deliveries and only ever frees a slot it can prove
 * is not resting at a broker.
 */
import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/cron/expire-orders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        const { adminClient } = await import("@/lib/scanner/pipeline.server");
        const { expireUnfilledOrders } = await import("@/lib/delivery/expire-unfilled.server");

        try {
          const outcomes = await expireUnfilledOrders(adminClient());
          return Response.json({
            ok: true,
            examined: outcomes.length,
            expired: outcomes.filter((o) => o.action === "expired").length,
            kept: outcomes.filter((o) => o.action === "kept").length,
            outcomes,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[cron/expire-orders]", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
