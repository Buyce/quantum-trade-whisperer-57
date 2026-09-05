# Weekend cost audit and quiet-hours guard

## What runs today (verified against the live cron schedule)

19 scheduled jobs fire 24/7, including weekends:

- `ptrades-scan-cycle` every 15 min + `scan-worker-drain` every 2 min — the worker
  calls MetaApi for candles on every instrument, all weekend, even though the FX
  week is closed Friday 21:00 UTC → Sunday 21:00 UTC (`isWeekendClosed` already
  exists in `src/lib/market-hours.ts` but the scanner never consults it).
- `refresh-armed-broker-accounts` every 5 min and `refresh-armed-account-specs`
  hourly — MetaApi account calls with no weekend check.
- `drain-execution-deliveries` every minute, `reconcile-broker-evidence` and
  `reconcile-active-signal-orders` every 5 min, `expire-unfilled-orders` every
  5 min — mostly cheap database work; they do nothing when queues are empty.
- The spread sampler already reads `isWeekendClosed` before sampling.

## What it costs

- **MetaApi:** billed as a flat per-account subscription, not per API call, so
  weekend calls do not add MetaApi charges. They are still wasted work.
- **Lovable Cloud:** the real weekend cost. The frequent jobs keep the database
  and server busy around the clock, which counts as compute usage even when the
  market is closed and nothing useful can result.

## Plan

1. **Scanner weekend guard.** In the scan cron entry and as a safety net in the
   worker claim path: when `isWeekendClosed(now)` is true, skip the cycle
   (return `skipped: "weekend_market_closed"`, no candle fetches). Queued jobs
   picked up during the weekend close as `skipped` without fetching.
2. **Broker-account refresh guard.** Skip MetaApi account/spec refreshes while
   the weekend closure is in effect; connection state from Friday close is
   retained and refreshed on the Sunday 21:00 UTC reopen. Reconnect/error
   surfacing still works on the next weekday run.
3. **Leave cheap DB-only jobs running.** Purges, expiry, telemetry rollups and
   reconciliation are near-zero cost and keep state truthful; no change.
4. **Honest heartbeat.** The scan heartbeat records the weekend skip as a
   deliberate skip, never as a scanner failure or a "degraded" state.

## Optional further saving

Cron wake-ups themselves (the HTTP call per schedule) still occur. If wanted,
the schedule of the two scanner jobs and the account-refresh job can later be
narrowed in the Jobs panel, but FX boundaries (Sunday 21:00 / Friday 21:00 UTC)
make the code guard the correct primary fix; schedule narrowing is a small
additional trim, not a substitute.

## Unchanged

Demo auto-trading, live gates, grading, and the zero-fabricated-data rule are
untouched. Weekday behavior is identical; the first Sunday 21:00 UTC cycle runs
normally.
