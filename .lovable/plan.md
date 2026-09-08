# Full audit: why "candle analysis" and "database → app calls" keep failing

## What these two cards are

**Candle analysis.** Every 15 minutes the engine writes a to-do list — one entry per
watched instrument. Each entry must be picked up and have its real price candles
fetched within 15 minutes, or it is closed untouched and counted as "discarded":
grading 20-minute-old prices would invent a setup that never existed. This card
answers "is the engine actually looking at the market right now?". While it reads
WORK DISCARDED, nothing can be published, no shadow/replay rows are created, and the
learning engine receives no new evidence. Nothing unsafe is traded — it is lost
opportunity and lost learning, not lost money.

**Database → app calls.** The scheduler lives in the database; the work happens in
the app, so the database calls the app over HTTP for every scheduled task (scan
cycle, queue drain, order dispatch, broker reconcile, spread sampling, reports).
This card counts those calls answered vs not answered in the last hour. If this link
is unreliable, scanning, order dispatch and broker evidence all move in bursts.

## Root cause — found in the app's own error log, not guessed

At 18:45:23 UTC the app logged **more than a dozen simultaneous** POSTs to
`/api/public/worker/process`, every one of them answered:

```text
502 — "The Workers runtime canceled this request because it detected that your
Worker's code had hung and would never generate a response."
```

That is the whole story, and it is self-inflicted:

1. **The hand-off turns one call into a burst.** Each worker pass hands the queue on
   to a successor *before* it starts its own batch (changed earlier today). Because
   the hand-off happens immediately, the successor immediately hands on again — so a
   single timer tick detonates the full 8-hop chain inside the same second, and there
   are two timers a minute. Result: 10–16 passes running at once instead of one after
   another.
2. **Those passes strangle each other on the broker.** The price provider allows only
   5 concurrent history requests per account, and the app's concurrency gate is
   per-instance, so it cannot restrain requests spread across many simultaneous
   passes. Every pass ends up waiting on the provider, the request produces no
   response, and the platform cancels it as hung → the 502s above.
3. **A cancelled pass abandons its claimed work.** Queue entries it had claimed stay
   marked "in progress" with nobody working them. Verified snapshot at 18:45: **0
   waiting, 15 in progress**, several claimed at 18:44:30 from the **18:30** cycle.
4. **Recovery is slower than the freshness rule, so discard is guaranteed.** Abandoned
   entries are only freed by `maintain_scan_queue`, which runs at :14/:29/:44/:59 and
   only after a 5-minute lease — up to 20 minutes. The freshness limit is 15 minutes.
   Anything abandoned is therefore *certain* to come back too old and be discarded.
   That is why 18:00 UTC reads 26 discarded / 0 analysed.
5. **The drain timers can't rescue it.** Both were tightened to fire only when entries
   are *waiting*. Abandoned entries are claimed, not waiting — so with 0 waiting and
   15 stuck, nothing calls the app at all. The queue looks idle while the cycle dies.

That is the loop that has repeated all day: burst → hang → 502 → abandoned claims →
no timer fires → 15-minute cleaner returns them too late → discarded → repeat.

## Why the second card also lies about the cause

- It counts calls for **every** scheduled task, including ones given only 4 seconds
  (scan cycle) or 20 seconds (dispatch, reconcile), so unrelated tight allowances
  inflate the red number.
- Its cause test treats *any* non-zero DNS time as an upstream name-lookup stall
  (`DNS time: [1-9]` matches "1.2 ms"). Today's failures read "DNS 1.2 ms, request
  20,002 ms" — our own hang — and were filed as DNS. The 18:00 sample shows 25 "DNS"
  vs 1 "timeout"; the app log shows the truth is our worker hanging.
- It has no category for a 502, which is the actual dominant failure.

So the card was pointing at the network while the fault was in our own throughput.

## The fix (in dependency order)

1. **One pass at a time.** Replace the burst chain with a single-flight worker: a
   short database lease (advisory lock / lease row) so only one pass runs at a time.
   The hand-off goes back to the end of the pass, awaited via the platform's
   background-task hook so it survives the response, with a hop ceiling of 3.
2. **Respect the broker's 5-request limit globally**, not per instance: cap in-flight
   history requests through a database-backed counter, and keep the per-pass batch at
   a size that finishes comfortably inside the caller's allowance.
3. **Make abandonment cheap:** claim lease 5 minutes → 2 minutes, and run the cleaner
   every minute, so an abandoned entry costs one minute rather than being condemned.
4. **Fix the drain guards** to fire when there is waiting work **or** an expired
   claim, so a queue full of abandoned entries can never sit with nothing calling.
5. **Make the pass provably non-hanging:** hard overall deadline well inside the
   caller's allowance, every broker read already abort-guarded, and the pass always
   returns a response even on abort — an abandoned claim should be impossible in the
   normal path.
6. **Report honestly:** count 502/hang as its own cause, only call it DNS when the
   lookup consumed essentially the whole elapsed time, and separate the scanner's own
   link from other scheduled tasks. Give each scheduled call clear headroom over the
   work it triggers (scan cycle 4 s → 10 s; dispatch/reconcile 20 s → 30 s).
7. **Verify with data, not hope:** after the change, watch one full hour for zero
   discarded entries, nothing sitting "in progress" beyond ~3 minutes, no 502 on the
   worker path, and a published/no-trade result for every cycle.

## Deliberately not changing

- The 15-minute freshness rule. Discarding stale work is the safety rule; the
  throughput around it is the bug.
- Grading, sizing, risk brakes, take-profit ladders, execution gates, user views.
- No synthetic signals, candles, market context or trades anywhere in this work.

## Technical detail

- `src/routes/api/public/worker/process.ts`: single-flight guard (Postgres advisory
  lock via an RPC, released in `finally`); move the chain back after the loop and
  dispatch it through the request's background-task hook; `MAX_HOPS` 8 → 3; overall
  deadline ~10 s with a guaranteed JSON response on abort.
- `src/lib/metaapi/market-gate.server.ts` + `pipeline.server.ts`: global in-flight
  budget for history reads (DB counter keyed to the benchmark account, TTL-expiring),
  keeping the existing per-instance gate as the inner limit.
- Migration: `maintain_scan_queue()` lease 5 min → 2 min; `maintain-scan-queue` to
  `* * * * *`; recreate both drain guards as
  `EXISTS (pending) OR EXISTS (processing AND started_at < now() - interval '2 minutes')`;
  raise `timeout_milliseconds` for `ptrades-scan-cycle` (4000 → 10000) and
  `drain-execution-deliveries` / `reconcile-active-signal-orders` /
  `reconcile-broker-evidence` / `refresh-armed-broker-accounts` (20000 → 30000);
  add the advisory-lock RPC.
- `sample_worker_call_health()` + `worker_call_health`: add `failed_5xx` and a
  scanner-path split; replace `DNS time: [1-9]` with a "DNS ≥ 90% of total" test;
  grants for the new columns. `get_admin_engine_status()` exposes them.
- `src/lib/engine-status.ts`, `src/lib/admin.functions.ts`,
  `src/components/admin/EngineStatusPanel.tsx`: render "app hung / server error" as
  its own cause and the scanner link separately; extend
  `src/lib/__tests__/scan-starvation.test.ts`.
- Evidence gathered for this plan: app error log (12+ concurrent worker 502s,
  "code had hung"), `scan_queue` snapshot (0 pending / 15 processing, oldest 26 min),
  hourly queue results (18:00 = 26 stale / 0 analysed), `worker_call_health`
  (18:00 = 60 ok / 35 failed, 25 mislabelled DNS), cron definitions and
  `maintain_scan_queue` / `claim_scan_job` bodies.
