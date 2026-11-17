/**
 * Broker evidence reconciliation worker (Prompt 14 Stage 4).
 *
 * Standalone and bounded: it reads broker history for accounts P-Trades has
 * actually submitted orders to and records positively associated deals as
 * evidence. It never publishes, never scans, and never touches a statistic, so
 * a slow broker here cannot delay a scan cycle.
 */
import { describeError } from "@/lib/errors/describe";
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
          // A pass with read/write errors is a FAILED pass for the scheduler: a 200
          // here would hide that some evidence was not imported.
          const ok = result.errors.length === 0;
          return Response.json({ ok, ...result }, { status: ok ? 200 : 502 });
        } catch (err) {
          const message = describeError(err);
          console.error("[worker/reconcile]", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
