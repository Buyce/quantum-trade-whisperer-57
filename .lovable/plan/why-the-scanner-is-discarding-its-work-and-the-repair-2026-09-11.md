# Why the scanner is discarding its work — and the repair

Yes, a repair is needed. The three cards on your screen are one fault, not three.

## What is actually happening (verified in the live data just now)

- Last 8 hours of queue results: hour after hour of **discarded** — 36, 36, 35, 33,
  9 so far this hour — with only a handful analysed (04:00 hour: 2 published,
  4 no-trade, 5 skipped). Every discarded job waited about **16 minutes** before
  anything touched it, just past the 15-minute freshness limit.
- The app is being called plenty: both minute timers ran 60 out of 60 times in the
  last hour. So the calls are not missing.
- What fails is the app's answer. The published log shows, about **every two
  minutes**, a scan pass that the hosting platform cancels with
  *"code had hung and would never generate a response"* → the `502 Internal server
  error` your card reports (35 in the last hour).
- Between those cancellations the queue is not idle-waiting for a timer: it is
  **locked out**. The single-flight lease is taken for 90 seconds and is only
  released at the clean end of a pass. A cancelled pass never releases it, so the
  next one-to-three minute timers answer "busy" and do nothing. Work then only
  happens in short bursts (04:10–04:11, 04:31, 04:46, 05:00) — exactly the pattern
  in the data — and everything enqueued in between ages out and is discarded.

So: setups are not absent. Roughly three quarters of the engine's work is being
thrown away untouched because the pass that should do it is being cancelled, and
its lock outlives it.

## Why a pass hangs

The shared market-data gate lets a call **wait with no time limit** for a free slot,
and its in-flight counter lives in module memory. When a pass is cancelled, its
cleanup does not run, so the counter stays high. That instance then has a
permanently full gate, and the next candle read waits forever — a request that can
never answer, which is precisely what the platform cancels. One cancellation
poisons the instance and produces the next.

A secondary effect: a job claimed by a cancelled pass sits in progress until the
2-minute reclaimer frees it, and each reclaim counts as an attempt — at three
attempts the job is marked failed outright (one per hour is happening).

## The repair

1. **No unbounded waits.** Cap the wait for a market-data slot (about 12s). On
   expiry the call raises a throttle, which the pipeline already records as a skip.
   Rebuild the in-flight count so a cancelled request cannot leak it permanently.
2. **A pass always answers.** Wrap the whole batch in a hard deadline inside the
   handler and reply with what was done, so no pass can be cancelled as hung.
3. **A dead pass must not hold the queue.** Cut the lease to about 25 seconds with
   a heartbeat while a pass is genuinely working, so a cancelled pass costs one
   timer tick instead of three.
4. **Stop lease reclaims from burning a job's attempts,** so a job returned to the
   queue is not condemned after three unrelated cancellations.
5. **Make the health card truthful.** Today "scanner calls 117 ok / 0 failed" only
   means the database's timer SQL ran — it never looks at the HTTP result, which is
   why the card said the scanner path was clean while every other call was being
   cancelled. Score scanner call health on the actual outcomes of the scan and
   worker calls instead.
6. **Keep the 15-minute freshness rule exactly as it is.** Discarding old work is
   correct; being starved of throughput is the bug. No change to grading, sizing,
   risk brakes, gates, or execution, and no synthetic rows anywhere.

## How we will know it worked

An hour of queue results with the discarded share back near zero, candle fetches
and analysed jobs in every cycle, and the `502` count on the call-health card
falling to occasional upstream stalls only.

## Technical notes

- `src/lib/metaapi/market-gate.server.ts`: bounded waiter with timeout, leak-safe
  counter (release keyed to the waiter, not a bare decrement), throttle-shaped error.
- `src/routes/api/public/worker/process.ts`: batch wrapped in a deadline race that
  always resolves to a JSON response; `LEASE_TTL_SECONDS` 90 → 25 with heartbeat
  renewal inside the loop; keep post-work chaining and the pending-guarded drains.
- Migration: lease heartbeat/renew RPC; `maintain_scan_queue()` no longer treats a
  lease-expiry return as a consumed attempt; `sample_worker_call_health()` scanner
  columns derived from `net._http_response` outcomes for the scan/worker paths
  rather than `cron.job_run_details.status`.
- `src/lib/engine-status.ts` wording follows the corrected counters; tests extended
  in `src/lib/__tests__/engine-status.test.ts` and the market-gate tests.
