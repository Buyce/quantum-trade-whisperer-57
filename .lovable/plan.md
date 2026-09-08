# Why both cards are red — and what those two cards actually mean

## What the two cards are

**Candle analysis.** Every 15 minutes the engine writes a to-do list: one entry per
watched instrument. Each entry must be picked up and have its real price candles
fetched within 15 minutes, or it is closed untouched and counted as "discarded" —
grading 20-minute-old prices would invent a setup that never existed. This card is
the honest answer to "is the engine actually looking at the market right now?".
When it reads WORK DISCARDED, no setups can be published, no shadow/replay rows are
created, and the learning engine gets no new evidence for that period. Nothing
unsafe is traded — it is a missed-opportunity fault, not a money fault.

**Database → app calls.** The scheduler lives in the database; all the work happens
in the app. The database therefore calls the app over HTTP for every scheduled task
(scan cycle, queue drain, order dispatch, broker reconcile, spread sampling,
reports). This card counts those calls answered vs unanswered in the last hour. If
this link is unreliable, everything downstream — scanning, order dispatch, broker
evidence — moves in bursts instead of continuously.

## What the live data shows right now (checked this evening)

- Queue snapshot: **0 waiting, 11 stuck "in progress", oldest 26 minutes**.
- Hour 18:00 UTC: **26 discarded, 0 analysed, 0 published**. Earlier hours mixed
  (17:00: 12 discarded, 2 published; 15:00: 16 discarded, 2 published).
- Last 90 minutes of database→app calls: 136 answered, **9 real "Internal server
  error" (502)** replies, plus about 15 calls that got no answer inside their allowance.
- The stuck-job cleaner (`maintain_scan_queue`) only runs at :14, :29, :44, :59 and
  only frees a job after a 5-minute lease.

## The three real faults

1. **Stuck claims are the actual bottleneck.** When a pass is cut off mid-work (502
   or no answer in time), the entries it claimed stay marked "in progress" forever.
   The two per-minute drain timers were tightened last time to fire *only when
   entries are waiting* — and stuck entries are not waiting, they are claimed. So
   nothing calls the app, nothing frees them, and the 15-minute cleaner returns them
   only after they are already too old to use. That is precisely today's 18:00 hour:
   0 waiting, 11 stuck, 26 discarded, nothing analysed. It does **not** self-heal
   reliably; it heals only when a cycle happens to land cleanly.

2. **The failure card is blaming the wrong thing.** The cause classifier counts any
   call whose DNS step took more than 0 ms as an upstream name-lookup stall. Today's
   failures read "DNS time: 1.2 ms, request time: 20,002 ms" — a slow answer from the
   app, filed as a DNS problem. The card also counts calls for *every* scheduled task,
   including ones given only 4 seconds, so unrelated short-allowance tasks inflate the
   red number and hide the 9 genuine server errors.

3. **Some allowances are too tight to ever succeed.** The 15-minute scan cycle call is
   given 4 seconds; order dispatch and broker reconcile are given 20 seconds against
   handlers that can legitimately use that long. Those calls are recorded as failures
   even when they did their work.

## The fix

1. Free stuck entries fast: shorten the claim lease to about 2 minutes and run the
   cleaner every minute, so a cut-off pass costs one minute of delay, not fifteen.
2. Make the two drain timers fire when there is waiting work **or** an expired claim,
   so the queue can never be stalled with nothing calling the app.
3. Correct the cause classifier: only call it a name-lookup stall when the lookup
   itself consumed essentially the whole elapsed time; otherwise it is "no answer in
   time" or "server error".
4. Count the scanner's own link separately from all other scheduled tasks, and show
   the genuine server-error count on the card, so the message names the true fault.
5. Give every scheduled call clear headroom over the work it triggers (scan cycle
   4 s → 10 s; dispatch and reconcile 20 s → 30 s), so a healthy call stops being
   recorded as a failure.
6. Read the app's own error log for the 9 server errors and fix whatever they name;
   if they are cold-start related, that is what the headroom above absorbs.

## Not changing

- The 15-minute freshness rule stays exactly as it is. Discarding old work is the
  safety rule; being starved of throughput is the bug.
- No change to grading, sizing, risk brakes, take-profit ladders, or execution gates.
- No synthetic signals, candles, or trades anywhere in this work.

## Technical detail

- Migration: `maintain_scan_queue()` lease `5 minutes` → `2 minutes`, reschedule
  `maintain-scan-queue` to `* * * * *`; recreate `scan-worker-drain` and
  `scan-worker-drain-offset` guards as
  `EXISTS (pending) OR EXISTS (processing AND started_at < now() - interval '2 minutes')`;
  raise `timeout_milliseconds` on `ptrades-scan-cycle` (4000 → 10000),
  `drain-execution-deliveries`, `reconcile-active-signal-orders`,
  `reconcile-broker-evidence`, `refresh-armed-broker-accounts` (20000 → 30000).
- `sample_worker_call_health()`: replace the `DNS time: [1-9]` test with a
  "DNS time ≥ 90% of total time" test, add a `failed_5xx` count, and attribute
  worker/scan-path calls separately from other scheduled calls (unattributable rows
  stay in the total only — nothing inferred).
- `worker_call_health`: new columns for the 5xx and scanner-path counts, with grants.
- `get_admin_engine_status()`: expose the new counts.
- `src/lib/engine-status.ts` + `src/lib/admin.functions.ts` +
  `src/components/admin/EngineStatusPanel.tsx`: render "server error" as its own
  cause and report the scanner link separately; tests extended in
  `src/lib/__tests__/scan-starvation.test.ts`.
- Verify after the change: an hour with discarded back at zero, no rows sitting in
  "in progress" beyond ~3 minutes, and the link card's failures reduced to genuine
  upstream stalls only.
