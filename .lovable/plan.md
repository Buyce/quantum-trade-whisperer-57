# Why the scan backlog exists — and why it will not clear itself

## What is actually wrong (verified just now)

The backlog you saw is a symptom. The real problem is worse: **the scanner has not looked at a single candle since 00:30 UTC today.**

Confirmed by direct queries:

- Every scan job enqueued since roughly 00:15 UTC has closed with `result = 'stale'` — 6 of 6 in the 07:00 hour, 36 of 36 in each hour before it. Average wait from enqueue to close: about 20 minutes.
- A job older than 15 minutes is deliberately closed without fetching candles (grading 20-minute-old queue entries against live prices would publish misleading setups). So all work is being discarded before any analysis happens.
- Broker call log agrees: `market-data` calls stop after the 00:00 hour. `instrument_health` for all nine instruments was last updated 00:16–00:30 UTC.
- Last published signal: 00:02 UTC.

## Root cause: the database's calls to the app are failing

The queue only advances when something calls the worker over HTTP. In the last 60 minutes the database's outbound calls produced:

- 105 successes
- **25 responses of `502 Internal server error`**
- **24 outright DNS timeouts** ("Timeout of 20000 ms reached... DNS time: 20000 ms")

The 2-minute drain schedule (`scan-worker-drain`) is active and fires on time, but roughly half its calls never reach the app. The app itself is healthy: calling the same production endpoint by hand returned `200` three times and drained the queue to zero immediately.

So: 9 jobs per 15-minute cycle need about 3 successful worker passes. With half the calls failing, a cycle regularly gets 1–2 passes, slips past 15 minutes, and every job is thrown away as stale. The next cycle inherits the same lag. It is a stable failure — it does **not** unclog itself, and it has been silently producing zero signals for seven hours while the dashboard showed a healthy-looking 7-job backlog.

## The fix

1. **More attempts per cycle.** Move the drain from every 2 minutes to every minute. An idle pass costs one cheap query, so 15 attempts per cycle means a 50% call-failure rate no longer starves a cycle.

2. **Two independent kick paths.** Add a second drain entry offset by 30 seconds, using a separate schedule, so one failing call path cannot stall the queue on its own.

3. **Make silent starvation impossible.** Record every `stale` closure as an engine fault, not a normal outcome. When more than a quarter of jobs in the last hour close stale, the Admin Intelligence engine panel turns red and states "scanner not analysing — jobs discarded before fetch", and the owner gets one email per incident (not per job).

4. **Surface the failing calls.** A small maintenance job samples `net._http_response` every 5 minutes and writes non-2xx / timed-out worker calls into a table, shown in Admin as "database → app call health (1h): N ok, N failed". A four-hour outage of that link was completely invisible today.

5. **Heartbeat truth on the operations panel.** The queue card currently shows pending count and oldest age. Add "last successful candle fetch" and "last non-stale job" from real data, tinted red past 30 minutes during market hours. That is the line that would have shown this at 00:45 instead of 07:15.

6. **One-off recovery.** Nothing to repair in data: the discarded jobs never wrote anything. After the drain change lands, the next cycle should show non-stale results and a fresh `market-data` fetch; verification is those two facts plus a signal or `no_trade` with a current timestamp.

## Not in this change

- The 15-minute staleness rule stays as it is — discarding old work is correct; being starved is the bug.
- No change to grading, sizing, risk brakes, execution, or any user-facing view.
- Zero synthetic rows: nothing here writes signals, market context, or trades.
- `GBPUSD` and `NAS100` are currently at lifecycle stage `data_validation`, so they are measured but never published. That is by design and stays untouched.

## Technical notes

- Migration: reschedule `scan-worker-drain` to `* * * * *`, add offset twin entry, add `worker_call_health` sampling job and table with grants and owner-only RLS.
- `public.get_admin_engine_status()` / `get_admin_intelligence()`: add stale-share, last non-stale job, last candle-fetch timestamps, and call-health counts.
- `src/components/admin/EngineStatusPanel.tsx` and `src/routes/_authenticated/admin/intelligence.tsx`: render the new fields and the red state.
- Stale-fault alert reuses the existing owner email path; one notice per incident, cleared when a non-stale job lands.
