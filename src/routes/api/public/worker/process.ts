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
 * Wall-clock budget. Deliberately WELL BELOW the caller's own patience: the
 * database's scheduled drain allows 25s, so a 20s budget meant every pass that
 * actually had work ran to the caller's cut-off — recorded as a failed call, and
 * (worse) aborted before it could hand the remaining queue on. 12s leaves room
 * for one in-flight candle fetch to finish inside the caller's window.
 */
const TIME_BUDGET_MS = 12_000;
/**
 * Self-chain hop ceiling. Without a cap, a queue that keeps refilling (or keeps
 * failing) would have every pass spawn another forever. Eight hops covers a
 * worst-case backlog; the 1-minute drain cron picks up anything beyond that.
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

        const { adminClient, processNextJob, pendingScanJobs } =
          await import("@/lib/scanner/pipeline.server");
        const { isWeekendClosed } = await import("@/lib/market-hours");
        // Weekend safety net: the cron entry no longer enqueues weekend
        // cycles, but if any job somehow sits pending after Friday 21:00 UTC
        // the worker leaves it queued rather than fetch candles while the
        // market is closed. On the Sunday reopen it is far past its interval
        // and closes as backlogged without a fetch.
        if (isWeekendClosed(new Date())) {
          return Response.json({ ok: true, skipped: "weekend_market_closed", processed: [] });
        }

        try {
          const db = adminClient();
          const startedAt = Date.now();

          /**
           * Hand off BEFORE doing the work, not after. A pass whose caller gives
           * up mid-work is aborted, and an aborted pass never reached the old
           * post-loop hand-off — which is precisely how a cycle's worth of jobs
           * aged past its freshness limit while the queue crawled three jobs per
           * minute. Claiming is atomic, so the successor cannot take our jobs
           * twice; it simply works the tail of the queue alongside us.
           */
          const pendingBefore = await pendingScanJobs(db);
          let chained = false;
          if (pendingBefore > MAX_JOBS_PER_REQUEST && hop < MAX_HOPS) {
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

          // Fallback hand-off: the queue may have refilled (or the pre-emptive
          // hand-off was not warranted) while this pass ran. Without it a
          // remainder would sit pending until the next drain tick.
          const remaining = processed.length ? await pendingScanJobs(db) : 0;
          if (!chained && remaining > 0 && hop < MAX_HOPS) {
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
            pendingBefore,
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
