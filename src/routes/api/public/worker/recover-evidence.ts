/**
 * Orphan broker-evidence recovery worker.
 *
 * Recovers real broker trades whose P-Trades delivery row was deleted by the
 * retention purge, straight from the broker's own deal history. Bounded,
 * authenticated with the shared cron secret, and separate from every other
 * worker so a slow broker here delays nothing.
 *
 * Optional body: `{ "windowDays": 30 }` (1-90).
 */
import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/worker/recover-evidence")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        const { adminClient } = await import("@/lib/scanner/pipeline.server");
        const { recoverOrphanEvidence } = await import("@/lib/evidence/recover.server");
        const { hasBenchmarkAccount, readBenchmarkAccount } = await import(
          "@/lib/metaapi/config.server"
        );

        let windowDays: number | undefined;
        try {
          const body = (await request.json()) as { windowDays?: unknown };
          if (typeof body?.windowDays === "number" && Number.isFinite(body.windowDays)) {
            windowDays = body.windowDays;
          }
        } catch {
          // No body is the normal cron case.
        }

        try {
          const benchmarkAccountId = hasBenchmarkAccount()
            ? readBenchmarkAccount().accountId
            : null;
          const result = await recoverOrphanEvidence(adminClient(), {
            benchmarkAccountId,
            ...(windowDays === undefined ? {} : { windowDays }),
          });
          return Response.json({ ok: true, ...result });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[worker/recover-evidence]", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
