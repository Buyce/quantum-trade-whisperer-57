/**
 * Broker evidence reconciliation worker (Prompt 14 Stage 4).
 *
 * Standalone and bounded: it reads broker history for accounts P-Trades has
 * actually submitted orders to and records positively associated deals as
 * evidence. It never publishes, never scans, and never touches a statistic, so
 * a slow broker here cannot delay a scan cycle.
 */
import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/worker/reconcile")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        const { adminClient } = await import("@/lib/scanner/pipeline.server");
        const { reconcileBrokerEvidence } = await import("@/lib/evidence/reconcile.server");
        const { hasBenchmarkAccount, readBenchmarkAccount } =
          await import("@/lib/metaapi/config.server");

        try {
          const benchmarkAccountId = hasBenchmarkAccount()
            ? readBenchmarkAccount().accountId
            : null;
          const result = await reconcileBrokerEvidence(adminClient(), { benchmarkAccountId });
          return Response.json({ ok: true, ...result });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[worker/reconcile]", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
