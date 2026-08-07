/**
 * Daily purge of accounts whose 30-day cancellation grace period has expired.
 * Secured with the shared cron secret — never publicly triggerable.
 */
import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/cron/purge-accounts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        const { accountAdminClient, purgeExpiredAccounts } = await import("@/lib/account.server");
        try {
          const report = await purgeExpiredAccounts(accountAdminClient());
          return Response.json({ ok: true, ...report });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[cron/purge-accounts]", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
