/**
 * Execution delivery worker. Bounded, authenticated with the shared cron secret,
 * and completely separate from the scan worker: a broker bridge hanging can
 * never delay a scan, a publication, or any statistic.
 *
 * Every pass first expires abandoned leases (fail closed to `unknown`), then
 * drains a small batch of `pending` deliveries.
 */
import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

const MAX_DELIVERIES_PER_REQUEST = 5;
const TIME_BUDGET_MS = 12_000;

export const Route = createFileRoute("/api/public/worker/dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        const { adminClient } = await import("@/lib/scanner/pipeline.server");
        const { processNextDelivery } = await import("@/lib/delivery/dispatch.server");
        const { expireUnansweredConfirmations } =
          await import("@/lib/delivery/expire-confirmations.server");

        try {
          const db = adminClient();

          let leasesExpired = 0;
          const { data: expired, error: expireError } = await db.rpc("expire_execution_leases");
          if (expireError) console.error("[worker/dispatch] lease expiry", expireError.message);
          else leasesExpired = Number(expired ?? 0);

          // Unanswered live confirmation requests are settled before anything is
          // claimed, so a passed window can never be submitted.
          const confirmationsExpired = await expireUnansweredConfirmations(db);

          const startedAt = Date.now();
          const processed = [];
          let budgetExhausted = false;
          for (let i = 0; i < MAX_DELIVERIES_PER_REQUEST; i++) {
            if (Date.now() - startedAt > TIME_BUDGET_MS) {
              budgetExhausted = true;
              break;
            }
            const result = await processNextDelivery(db);
            if (!result) break;
            processed.push(result);
          }

          return Response.json({
            ok: true,
            leasesExpired,
            confirmationsExpired,
            processed,
            drained: processed.length,
            budgetExhausted,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[worker/dispatch]", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
