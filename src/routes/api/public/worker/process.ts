/**
 * Queue worker. Processes jobs one pass at a time across ALL invocations
 * (single-flight), and chains to itself AFTER its batch while work remains.
 *
 * Why single-flight: a pre-work hand-off used to turn one timer tick into a
 * burst of 10-16 simultaneous passes. They strangled each other on the price
 * provider's 5-request concurrency cap, produced no response, and the platform
 * cancelled them as hung — leaving claimed jobs abandoned until the cleaner
 * freed them, by which time the 15-minute freshness rule made discard certain.
 * A TTL lease row in the database coordinates across invocations (advisory
 * locks do not survive connection pooling); a crashed pass frees the lease by
 * expiry and the every-minute drain cron picks the queue back up.
 *
 * Triggered automatically by the scan_queue insert trigger, by the pg_cron
 * drain safety nets (every minute, guarded on pending work OR an expired
 * claim), or manually with the shared secret.
 */
import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

/**
 * Wall-clock window in which NEW jobs may be claimed. A job already in flight
 * always runs to completion (its broker reads are individually abort-guarded),
 * so a pass can exceed this by one job's duration — measured p95 is ~16s,
 * comfortably inside the caller's 30s patience.
 */
const CLAIM_WINDOW_MS = 10_000;
/**
 * Self-chain hop ceiling. The chain is post-work only, and the lease makes
 * overlapping passes harmless (they exit immediately as busy), so three hops
 * plus the two per-minute drain timers give ample drain throughput.
 */
const MAX_HOPS = 3;
/**
 * Lease TTL. Deliberately short: a pass the platform cancels never runs its
 * cleanup, and a long TTL turned one cancellation into 90 seconds of a locked
 * queue — every drain timer answering "busy" while jobs aged past the
 * 15-minute freshness rule and were discarded untouched. A live pass renews the
 * lease on every job, so a genuinely working pass is never cut off, while a
 * dead one costs at most one timer tick.
 */
const LEASE_TTL_SECONDS = 25;
/**
 * Hard deadline for the whole handler. Whatever the state of the work, a
 * response is returned by this point: the platform cancels a request that never
 * answers, and a cancelled pass strands its claimed jobs and its lease.
 */
const RESPONSE_DEADLINE_MS = 20_000;

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

        const db = adminClient();

        /**
         * Every pass records its own outcome. Truthful call health depends on
         * it: a call the platform cancels leaves no row, which is how a
         * cancelled pass is told apart from a pass that ran and found nothing.
         */
        const logPass = async (outcome: string, drained: number, detail?: string | null) => {
          await db
            .from("worker_pass_log")
            .insert({
              source: "worker_process",
              hop,
              outcome,
              drained,
              duration_ms: Date.now() - startedAt,
              detail: detail ?? null,
            })
            .then(
              () => {},
              () => {},
            );
        };

        /**
         * Single-flight gate. A second concurrent pass is not an error — it is
         * the drain timers overlapping — so it answers 200 "busy" and exits
         * instead of competing for broker requests.
         */
        const holder = crypto.randomUUID();
        const startedAt = Date.now();
        const { data: acquired, error: leaseError } = await db.rpc(
          "try_acquire_scan_worker_lease",
          { p_holder: holder, p_ttl_seconds: LEASE_TTL_SECONDS },
        );
        if (leaseError) {
          // The lease store failing must not silently stall the queue: proceed
          // without it (pre-fix behaviour) rather than refuse all work.
          console.error("[worker/process] lease acquire failed:", leaseError.message);
        } else if (!acquired) {
          await logPass("busy", 0);
          return Response.json({ ok: true, busy: true, processed: [], hop });
        }

        const releaseLease = () =>
          db.rpc("release_scan_worker_lease", { p_holder: holder }).then(
            () => {},
            () => {},
          );

        const processed: Awaited<ReturnType<typeof processNextJob>>[] = [];
        let budgetExhausted = false;
        let deadlineHit = false;

        const runBatch = async (): Promise<{ failed?: string }> => {
          try {
            for (;;) {
              if (deadlineHit) break;
              if (Date.now() - startedAt > CLAIM_WINDOW_MS) {
                budgetExhausted = true;
                break;
              }
              const result = await processNextJob(db);
              if (!result) break;
              processed.push(result);
              // Keep the short lease alive while real work is happening.
              await db
                .rpc("renew_scan_worker_lease", {
                  p_holder: holder,
                  p_ttl_seconds: LEASE_TTL_SECONDS,
                })
                .then(
                  () => {},
                  () => {},
                );
            }
            return {};
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[worker/process]", message);
            return { failed: message };
          }
        };

        const deadline = new Promise<{ timedOut: true }>((resolve) => {
          setTimeout(() => {
            deadlineHit = true;
            resolve({ timedOut: true });
          }, RESPONSE_DEADLINE_MS);
        });

        const outcome = await Promise.race([runBatch(), deadline]);

        if ("timedOut" in outcome) {
          // The batch is still running somewhere; answering now is what keeps
          // the platform from cancelling this request as hung. The lease is
          // released so the next timer tick can pick the queue up, and any job
          // left in flight is returned by the queue maintainer without
          // consuming one of its attempts.
          void releaseLease();
          await logPass("deadline", processed.length, `no response within ${RESPONSE_DEADLINE_MS}ms`);
          return Response.json({
            ok: true,
            timedOut: true,
            processed,
            drained: processed.length,
            hop,
          });
        }

        await releaseLease();

        if (outcome.failed) {
          await logPass("error", processed.length, outcome.failed);
          // Guaranteed JSON: a pass must never hang without a response, which
          // is what got it cancelled as "hung" and stranded its claimed jobs.
          return Response.json({ ok: false, error: outcome.failed }, { status: 500 });
        }

        // Post-work hand-off only: the successor starts after THIS pass has
        // finished and released the lease, so passes run back-to-back instead
        // of fanning out. If the platform drops the fire-and-forget call, the
        // every-minute drain timers (which also fire on expired claims) pick
        // the remainder up within a minute.
        const remaining = processed.length ? await pendingScanJobs(db) : 0;
        let chained = false;
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

        await logPass(processed.length ? "processed" : "idle", processed.length);

        return Response.json({
          ok: true,
          processed,
          drained: processed.length,
          budgetExhausted,
          remaining,
          hop,
          chained,
        });
      },
    },
  },
});

