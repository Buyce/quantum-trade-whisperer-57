# Why the scanner says "work discarded", and how to fix it

## What the message means

Each scan cycle puts a list of instruments in a work queue. A queued item must be
picked up and have its price candles fetched within 15 minutes, or it is closed
untouched and marked "discarded" — because analysing 20-minute-old market data
would produce a setup that was never really there.

So the banner is saying: *setups aren't missing, the work never got done in time*.

## What the data actually shows (checked today)

- Queue results per hour today: 04:00 18 discarded / 0 analysed; 05:00 36/0;
  06:00 36/0; 07:00 15 discarded, 8 analysed; 09:00 0 discarded, 12 analysed;
  11:00 27 discarded, 3 analysed; 12:00 0 discarded so far. It comes and goes.
- Database → app calls in the last hour: 147 answered, 42 with no answer at all.
  Recent failures read `Timeout of 20000 ms reached`, some with the whole 20
  seconds spent in DNS.
- Right now the queue is clean: 0 waiting, 2 in progress.

## Where the bottleneck is

Three separate things, all in the hand-off between the database timer and the app:

1. **Timeout collision.** The every-minute drain timer gives the app 20,000 ms
   (`scan-worker-drain-offset`), and the app's own work budget is exactly 20,000 ms
   (`TIME_BUDGET_MS` in `src/routes/api/public/worker/process.ts`). A pass that
   genuinely has work therefore *always* runs to the caller's cut-off and is
   recorded as a failed call — even when it did useful work. That is why the card
   reads FAILING while jobs are still being analysed.
2. **Cancelled continuation.** When the caller cuts the request off, the request
   is aborted. The pass hands the remaining queue to itself with a fire-and-forget
   call at the very end of the handler, so an aborted pass never hands off. The
   backlog then only moves 3 items per minute, and a cycle's worth of items ages
   past 15 minutes.
3. **Wasted calls and real DNS stalls.** The offset timer fires every minute even
   with an empty queue, and some calls burn the full 20 s inside DNS — genuine
   upstream stalls, unrelated to our code, which the counters currently mix in
   with the self-inflicted timeouts.

## Does it need solving, and is it hurting the platform?

Yes it needs solving, and no money is at risk. Nothing wrong is ever traded — the
guard exists precisely so stale prices never reach an order. The cost is missed
opportunity: in the hours above, whole cycles produced no setups for customers or
for the learning engine. It does not self-heal reliably; it only looks healthy when
the calls happen to succeed.

## The fix

1. Cut the app's work budget to 12 s and keep the caller's allowance at 25 s, so a
   pass always answers inside the caller's patience instead of being cut off.
2. Send the hand-off for remaining work *before* the long work of the pass, so a
   slow or aborted pass still passes the baton.
3. Make the offset timer fire only when items are actually waiting, matching the
   main drain, so idle minutes stop being counted as calls.
4. Separate the counters: distinguish "no answer within our own budget" from
   "name lookup failed upstream", so the Admin card names the real fault instead of
   one blended FAILING state.
5. Keep the 15-minute freshness rule exactly as it is. It is the safety rule; the
   throughput around it is what changes.

## Technical detail

- `src/routes/api/public/worker/process.ts`: `TIME_BUDGET_MS` 20_000 → 12_000;
  move the self-chain dispatch ahead of the job loop, keyed on pending count, hop
  ceiling unchanged.
- Migration: recreate `scan-worker-drain-offset` with `timeout_milliseconds := 25000`
  and a `WHERE EXISTS (SELECT 1 FROM public.scan_queue WHERE status = 'pending')`
  guard; `scan-worker-drain` already has both.
- `public.sample_worker_call_health()` / `worker_call_health`: classify the failure
  detail into `timeout` vs `dns` counts; `src/lib/engine-status.ts` reports the
  dominant cause, tests extended in `src/lib/__tests__/engine-status.test.ts`.
- No change to `JOB_STALE_AFTER_MS`, to grading, or to any execution gate.
- Verify after the change: an hour of `scan_queue` results with discarded back to
  zero, and `worker_call_health` failures dropping to genuine upstream stalls only.
