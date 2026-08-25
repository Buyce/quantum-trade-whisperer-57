# Operations

## Purpose

Describe the scheduled work, the runbooks, and how to tell a broken system from a
correctly quiet one.

## Current behaviour

### Scheduled endpoints

All are `POST` under `/api/public/cron/*` (and `/api/public/worker/*`), each
authenticated by the shared cron secret. Schedules are held in the database
scheduler, not in the repository, so the table below names each job's purpose and
cadence rather than asserting a crontab line.

| Endpoint                | Cadence          | Work                                                 |
| ----------------------- | ---------------- | ---------------------------------------------------- |
| `cron/scan`             | every 15 minutes | enqueue scan jobs; sweep stale signals               |
| `worker/dispatch`       | frequent         | hand queued jobs to workers                          |
| `worker/process`        | frequent         | one instrument x timeframe per invocation            |
| `worker/shadow`         | frequent         | shadow replay work                                   |
| `cron/shadow-resolve`   | periodic         | resolve shadow executions from stored candles        |
| `cron/refresh-specs`    | daily, 02:40 UTC | refresh broker symbol specs on a separate 24h budget |
| `cron/verify-reminders` | daily            | remind users to backfill actual prices               |
| `cron/weekly-report`    | weekly           | weekly shadow/performance report email               |
| `cron/purge-accounts`   | daily            | hard-delete accounts past their restore window       |
| `cron/sample-spreads`   | every 15 minutes | one broker quote per authorised instrument, classified and stored |
| `cron/telemetry-rollup` | hourly           | spread aggregation, telemetry retention, resolver health |
| `cron/instrument-readiness` | daily, 03:10 UTC | readiness snapshot with live conversion proof     |

### Operational telemetry (Wave 0 only)

Spread sampling is bounded in four independent ways, in this order: the
`telemetry_controls` kill switch (unreadable means OFF), a slot claim that permits
exactly one run per 15-minute UTC slot per sampler version, per-run instrument and
request ceilings that the database may lower but never raise above the compiled
values, and a fresh per-instrument stage and breaker check before any request.

Authorised scope today is XAUUSD, GBPAUD and EURUSD — 288 instrument-slots per
day, one quote each, no candle fetches. Wave 1 symbols are not sampled.

Sampling is side-effect-free collection: it grades nothing, publishes nothing,
alerts nobody and cannot promote an instrument. It is allowed at
`data_validation`, `shadow`, `signals_only` and `execution_approved`, and refused
at `disabled` and `suspended`.

A measurement that is stale, crossed, zero-spread, undated, future-dated or taken
while the market is closed is stored as a CLASSIFIED ATTEMPT, never as a spread.
Zero valid samples therefore means "nothing measured", which is not evidence that
spreads are acceptable, and a spread floor may not be derived from it.

ATR context is written by the scanner from candles it had already fetched, so it
costs no provider request. A telemetry write failure is always swallowed: telemetry
may never break a scan cycle.

Spec refresh is deliberately **not** part of the scan cron: sharing the MetaApi
budget with the scanner is how a scan cycle starves.

### Stable URLs

`project--<id>.lovable.app` (production) and `project--<id>-dev.lovable.app`
(preview) are immutable and are what external schedulers should target.

### Signal lifecycle

Active setups older than `SIGNAL_MAX_AGE_HOURS` (24) are swept to `expired` at the
start of each scan cycle. Retention for hard deletion is tiered by grade: A+/A 48h,
B 36h, C 24h. Beyond retention, rows leave the interactive feed, so a "missing"
old signal is expected behaviour. Deletion is blocked until shadow replay has
copied the signal geometry and while any delivery is pending, claimed, sent or
ambiguous. The system-generated signal and market-context row is then copied in
the same transaction to the immutable, service-only `signal_retention_archive`.
The archive contains no user identifiers and is evidence storage, not automatic
permission to train or promote a model. User decisions and interaction telemetry
are deliberately not copied into it.

### Health signals

- `get_scanner_status` / the in-app heartbeat is the authority on whether the
  scanner is cycling.
- An empty feed is **not** a health signal, and it is **not** by itself a No-Trade
  claim: the feed is filtered by the user's instruments, sessions, minimum grade,
  daily cap and retention window. Read it as "nothing matches this view". Only an
  unfiltered, current-cycle read supports a scanner-wide No-Trade statement.

- Market closed (weekend) means no new candles, therefore no new signals.

### Runbooks

**Feed empty.** Check the heartbeat first. Cycling + empty ⇒ correct No-Trade.
Not cycling ⇒ check the cron caller, the worker queue and the MetaApi budget.

**Scan backlog.** Jobs accumulate when workers are not being dispatched. Verify
`worker/dispatch` and `worker/process` are being called and returning 2xx.

**MetaApi timeout.** Every fetch is wrapped in an 8-second timeout; on expiry the
pair is skipped, flagged temporarily unavailable, and the scanner advances. Repeated
timeouts on one instrument point at the upstream data bug, not at the scanner.

**Stale broker specs.** Sizing refuses with `stale_spec` rather than sizing on old
data. Re-run `cron/refresh-specs`.

**Delivery stuck.** `sent` and `unknown` are terminal for automation by design —
an unacknowledged POST may already have created a broker order. Resolve manually;
never bulk-retry. These states also block signal retention deletion so the
operational parent evidence remains available until resolution.

**Never** seed, backfill or synthesise `scanned_signals`, `market_context` or
`executed_trades` to make a screen look populated.

## Inputs

Cron secret, database queue state, MetaApi budget.

## Outputs

Queue transitions, published signals, resolved shadow rows, refreshed specs, sent
reports.

## Failure behaviour

Every scheduled job is independently retriable and isolated: a failure in
execution delivery, reporting or research never interrupts the scanner or any
statistic.

## User-facing meaning

Settings shows the scanner's last cycle. Quiet markets look quiet.

## What operations does not guarantee

Continuous upstream data availability, or that a scheduled job external to this
app is actually calling in.

## Provenance

Heartbeat times, cycle counts and market status all come from rows the workers
actually wrote, plus the broker's own candle timestamps — never from a clock
assumption about when a job "should" have run. A stale heartbeat is reported as
stale rather than smoothed over.

## Implementation

`src/routes/api/public/cron/*`, `src/routes/api/public/worker/*`,
`src/lib/cron-auth.ts`, `src/lib/scanner/pipeline.server.ts`,
`src/lib/scanner/metaapi.server.ts`, `src/lib/db-types.ts`,
`src/components/ScanHeartbeat.tsx`, `src/components/MarketStatus.tsx`.

## Tests

`src/lib/scanner/__tests__/*`, `src/lib/__tests__/market-hours.test.ts`.
