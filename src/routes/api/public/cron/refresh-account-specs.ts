/**
 * Scheduled refresh of armed accounts' broker contract specifications.
 *
 * Bounded and authenticated with the shared cron secret. It only ever writes
 * specifications the broker itself returned; it submits nothing, authorises
 * nothing, and never touches signals, alerts or statistics.
 */
import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/cron/refresh-account-specs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        const { isWeekendClosed } = await import("@/lib/market-hours");
        // Weekend closure: specifications cannot change while the market is
        // closed; the next weekday run refreshes them before any order.
        if (isWeekendClosed(new Date())) {
          return Response.json({ ok: true, skipped: "weekend_market_closed" });
        }

        const { adminClient } = await import("@/lib/scanner/pipeline.server");
        const { refreshArmedAccountSpecs } =
          await import("@/lib/accounts/refresh-armed-specs.server");

        try {
          const outcome = await refreshArmedAccountSpecs(adminClient());
          return Response.json({ ok: true, ...outcome });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[cron/refresh-account-specs]", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
