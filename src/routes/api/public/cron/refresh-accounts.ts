/**
 * Scheduled armed-account broker refresh.
 *
 * Bounded and authenticated with the shared cron secret. It only ever writes
 * broker-reported figures onto armed accounts; it submits nothing, authorises
 * nothing, and never touches signals, alerts or statistics.
 */
import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/cron/refresh-accounts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        const { isWeekendClosed } = await import("@/lib/market-hours");
        // Weekend closure: the broker state from Friday close is retained and
        // refreshed on the Sunday 21:00 UTC reopen; no MetaApi calls until then.
        if (isWeekendClosed(new Date())) {
          return Response.json({ ok: true, skipped: "weekend_market_closed" });
        }

        const { adminClient } = await import("@/lib/scanner/pipeline.server");
        const { refreshArmedAccounts } = await import("@/lib/accounts/refresh-armed.server");

        try {
          const outcome = await refreshArmedAccounts(adminClient());
          return Response.json({ ok: true, ...outcome });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[cron/refresh-accounts]", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
