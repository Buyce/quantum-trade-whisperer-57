/**
 * Queue worker. Processes a small batch per pass and chains to itself while
 * work remains, with a wall-clock budget so no single invocation runs long.
 *
 * Triggered automatically by the scan_queue insert trigger, by the pg_cron
 * drain safety net (every 2 minutes), or manually with the shared secret.
 */
import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

const MAX_JOBS_PER_REQUEST = 3;
/**
 * Wall-clock budget. A job can spend up to 3 × 8s on candle fetches alone, so a
 * count-only bound could push one request past the platform timeout — which is
 * exactly how jobs used to get abandoned mid-write. We stop starting new jobs
 * once the budget is spent and let the next pass drain the rest.
 */
const TIME_BUDGET_MS = 20_000;
/**
 * Self-chain hop ceiling. Without a cap, a queue that keeps refilling (or keeps
 * failing) would have every pass spawn another forever. Eight hops covers a
 * worst-case backlog; the 2-minute drain cron picks up anything beyond that.
 */
const MAX_HOPS = 8;

export const Route = createFileRoute("/api/public/worker/process")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        let hop = 0;
        try {
          const body = (await request.clone().json()) as { hop?: unknown } | null;
          const raw = Number(body?.hop ?? 0);
          hop = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
        } catch {
          hop = 0;
        }

        const { adminClient, processNextJob, pendingScanJobs } = await import(
          "@/lib/scanner/pipeline.server"
        );
        try {
          const db = adminClient();
          const startedAt = Date.now();
          const processed = [];
          let budgetExhausted = false;
          for (let i = 0; i < MAX_JOBS_PER_REQUEST; i++) {
            if (Date.now() - startedAt > TIME_BUDGET_MS) {
              budgetExhausted = true;
              break;
            }
            const result = await processNextJob(db);
            if (!result) break;
            processed.push(result);
          }

          // The queue only progresses if someone kicks it again. The insert
          // trigger fires once per cycle, so a pass that stops with work left
          // must hand off itself or the remainder sits pending indefinitely.
          let chained = false;
          const remaining = processed.length ? await pendingScanJobs(db) : 0;
          if (remaining > 0 && hop < MAX_HOPS) {
            chained = true;
            void fetch(new URL("/api/public/worker/process", request.url).toString(), {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-cron-secret": request.headers.get("x-cron-secret") ?? "",
              },
              body: JSON.stringify({ source: "worker_self_chain", hop: hop + 1 }),
            }).catch(() => {});
          }

          return Response.json({
            ok: true,
            processed,
            drained: processed.length,
            budgetExhausted,
            remaining,
            hop,
            chained,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[worker/process]", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
