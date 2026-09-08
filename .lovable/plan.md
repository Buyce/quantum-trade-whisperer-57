# Full audit: why "candle analysis" and "database - app calls" keep failing

## What these two cards are

**Candle analysis.** Every 15 minutes the engine writes a to-do list - one entry per
watched instrument. Each entry must be picked up and have its real price candles
fetched within 15 minutes, or it is closed untouched and counted as "discarded":
grading 20-minute-old prices would invent a setup that never existed. This card
answers "is the engine actually looking at the market right now?". While it reads
WORK DISCARDED, nothing can be published, no shadow/replay rows are created, and the
learning engine receives no new evidence. Nothing unsafe is traded - it is lost
opportunity and lost learning, not lost money.

**Database - app calls.** The scheduler lives in the database; the work happens in
the app, so the database calls the app over HTTP for every scheduled task (scan
cycle, queue drain, order dispatch, broker reconcile, spread sampling, reports).
This card counts those calls answered vs not answered in the last hour. If this link
is unreliable, scanning, order dispatch and broker evidence all move in bursts.

## Root cause - found in the app's own error log, not guessed

At 18:45:23 UTC the app logged **more than a dozen simultaneous** POSTs to
`/api/public/worker/process`, every one answered:

```text
502 - "The Workers runtime canceled this request because it detected that your
Worker's code had hung and would never generate a response."
```

That is the whole story, and it is self-inflicted:

1. **The hand-off turns one call into a burst.** Each worker pass hands the queue on
   to a successor *before* it starts its own batch (changed earlier today). Because
   the hand-off is immediate, the successor immediately hands on again - so a single
   timer tick detonates the full 8-hop chain inside the same second, and there are
   two timers a minute. Result: 10-16 passes running at once instead of one after
   another.
2. **Those passes strangle each other on the broker.** The price provider allows
   only 5 concurrent history requests per account, and the app's concurrency gate is
   per-instance, so it cannot restrain requests spread across many simultaneous
   passes. Every pass ends up waiting on the provider, produces no response, and the
   platform cancels it as hung - the 502s above.
3. **A cancelled pass abandons its claimed work.** Verified snapshot at 18:45: **0
   waiting, 15 in progress**, several claimed at 18:44:30 from the **18:30** cycle.
4. **Recovery is slower than the freshness rule, so discard is guaranteed.**
   Abandoned entries are only freed by `maintain_scan_queue`, which runs at
   :14/:29/:44/:59 and only after a 5-minute lease - up to 20 minutes. The freshness
   limit is 15 minutes. Anything abandoned is therefore *certain* to come back too
   old and be discarded. That is 18:00 UTC: 26 discarded, 0 analysed.
5. **The drain timers can't rescue it.** Both were tightened to fire only when
   entries are *waiting*. Abandoned entries are claimed, not waiting - so with 0
   waiting and 15 stuck, nothing calls the app at all.

That is the loop that repeated all day: burst - hang - 502 - abandoned claims - no
timer fires - cleaner returns them too late - discarded - repeat.

## Why the second card also misreports the cause

- It counts calls for **every** scheduled task, including ones given only 4 seconds
  (scan cycle) or 20 seconds (dispatch, reconcile), inflating the red number.
- Its cause test treats *any* non-zero DNS time as an upstream stall. Today's
  failures read "DNS 1.2 ms, request 20,002 ms" - our own hang - and were filed as
  DNS (18:00 sample: 25 "DNS" vs 1 "timeout"). The app log shows the truth is our
  worker hanging.
- It has no category for a 502, which is the actual dominant failure.

## Does the fix make anything slower, weaker or less connected? No - measured

Measured per-job durations from the last 12 hours of real runs:

```text
published:  avg 9.6 s   worst 5% 16 s
no_trade:   avg 6.4 s   worst 5% 12.5 s
skipped:    avg 6.7 s   worst 5% 12.5 s
```

A full 9-instrument cycle processed **strictly one at a time** therefore takes
roughly 60-90 seconds against a 15-minute freshness window - about ten times more
headroom than needed. The old system was not faster; the "parallelism" was the
illusion that produced hangs and a 94% discard rate. Sequential is faster in the
only way that matters: work that actually completes.

Path-by-path impact:

| Path | Effect |
|---|---|
| Scanning / publishing | Completes every cycle instead of discarding 94% of it |
| Feed freshness | One cycle's work still lands ~10+ minutes before expiry |
| Shadow replay / learning | Runs on its own queue and engine; untouched. It only *gains* rows, because published signals stop disappearing |
| Auto-trader orders | Order dispatch is a separate route and queue; untouched |
| Broker evidence / reconcile | Separate timers; only change is their allowance rises 20 s - 30 s |
| UI speed / terminal | No user-facing request is changed at all |
| Accuracy | Identical grading code and identical candles; the 15-minute rule is untouched |

## The fix (in dependency order)

1. **One pass at a time.** Single-flight worker via a short database lease
   (advisory lock RPC, released in `finally`); the chain returns to *after* the
   loop and is dispatched through the request's background-task hook so it survives
   the response; hop ceiling 8 - 3.
2. **Respect the broker's 5-request limit globally**, not per instance: a
   database-backed in-flight counter with TTL, keeping the per-instance gate as the
   inner limit.
3. **Make abandonment cheap:** claim lease 5 minutes - 2 minutes, cleaner every
   minute, so an abandoned entry costs one minute instead of being condemned.
4. **Fix the drain guards** to fire on waiting work **or** an expired claim.
5. **Provably non-hanging pass:** overall deadline ~10 s, every broker read already
   abort-guarded, and the pass always returns JSON even on abort - no response-free
   hang, no abandoned claim in the normal path.
6. **Report honestly:** count 502/hang as its own cause; "DNS" only when lookup
   consumed ~all elapsed time; separate the scanner's own link from other tasks;
   give each scheduled call headroom over the work it triggers (scan cycle 4 s -
   10 s; dispatch/reconcile 20 s - 30 s).
7. **Verify with data:** after landing, watch one full hour for zero discards,
   nothing in "in progress" beyond ~3 minutes, no worker 502s, and a published or
   no-trade result for every cycle.

## Deliberately not changing

- The 15-minute freshness rule. Discarding stale work is the safety rule; the
  throughput around it is the bug.
- Grading, sizing, risk brakes, take-profit ladders, execution gates, user views.
- No synthetic signals, candles, market context or trades anywhere in this work.

## Technical detail

- `src/routes/api/public/worker/process.ts`: advisory-lock single-flight; chain
  moved after the loop and run via the background-task hook; `MAX_HOPS` 8 - 3;
  ~10 s deadline with guaranteed JSON response on abort.
- `src/lib/metaapi/market-gate.server.ts` + `pipeline.server.ts`: global in-flight
  budget for history reads (TTL-expiring DB counter for the benchmark account);
  existing per-instance gate remains the inner limit.
- Migration: advisory-lock RPC; `maintain_scan_queue()` lease 5 min - 2 min;
  `maintain-scan-queue` to `* * * * *`; both drain guards become
  `EXISTS (pending) OR EXISTS (processing AND started_at < now() - interval '2 minutes')`;
  `timeout_milliseconds`: `ptrades-scan-cycle` 4000 - 10000,
  `drain-execution-deliveries`, `reconcile-active-signal-orders`,
  `reconcile-broker-evidence`, `refresh-armed-broker-accounts` 20000 - 30000.
- `sample_worker_call_health()` + `worker_call_health`: add `failed_5xx` and a
  scanner-path split; replace `DNS time: [1-9]` with "DNS >= 90% of total";
  grants for new columns. `get_admin_engine_status()` exposes them.
- `src/lib/engine-status.ts`, `src/lib/admin.functions.ts`,
  `src/components/admin/EngineStatusPanel.tsx`: render "app hung / server error" as
  its own cause; extend `src/lib/__tests__/scan-starvation.test.ts`.
- Evidence for this plan: app error log (12+ concurrent worker 502s, "code had
  hung"), queue snapshot (0 pending / 15 processing, oldest 26 min), hourly results
  (18:00 = 26 stale / 0 analysed), link-health samples (60 ok / 35 failed, 25
  mislabelled DNS), per-job durations (avg 6.4-9.6 s), cron definitions and the
  `maintain_scan_queue` / `claim_scan_job` bodies.
