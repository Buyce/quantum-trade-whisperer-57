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

| Endpoint                    | Cadence          | Work                                                              |
| --------------------------- | ---------------- | ----------------------------------------------------------------- |
| `cron/scan`                 | every 15 minutes | enqueue scan jobs; sweep stale signals                            |
| `worker/dispatch`           | frequent         | hand queued jobs to workers                                       |
| `worker/process`            | frequent         | one instrument x timeframe per invocation                         |
| `worker/shadow`             | frequent         | shadow replay work                                                |
| `worker/reconcile-active`   | every 5 minutes  | second attempt at automatic orders for still-active setups        |
| `worker/reconcile`          | every 5 minutes  | match submitted broker orders/deals into broker evidence          |
| `cron/shadow-resolve`       | periodic         | resolve shadow executions from stored candles                     |
| `cron/refresh-specs`        | daily, 02:40 UTC | refresh broker symbol specs on a separate 24h budget              |
| `cron/verify-reminders`     | daily            | remind users to backfill actual prices                            |
| `cron/weekly-report`        | weekly           | weekly shadow/performance report email                            |
| `cron/purge-accounts`       | daily            | hard-delete accounts past their restore window                    |
| `cron/sample-spreads`       | every 15 minutes | one broker quote per authorised instrument, classified and stored |
| `cron/telemetry-rollup`     | hourly           | spread aggregation, telemetry retention, resolver health          |
| `cron/instrument-readiness` | daily, 03:10 UTC | readiness snapshot with live conversion proof                     |
| `cron/advance-instruments`  | daily, 05:40 UTC | one audited lifecycle step per instrument on recorded evidence    |

### Operational telemetry (in-service instruments only)

Spread sampling is bounded in four independent ways, in this order: the
`telemetry_controls` kill switch (unreadable means OFF), a slot claim that permits
exactly one run per 15-minute UTC slot per sampler version, per-run instrument and
request ceilings that the database may lower but never raise above the compiled
values, and a fresh per-instrument stage and breaker check before any request.

Each measurement re-asks the provider once when the first answer is unusable and
the market is not closed. The provider's first answer after a cold price request
is frequently degenerate — bid exactly equal to ask, with its own timestamp
seconds old — and one such tick must not be recorded as "this instrument cannot
be priced". The re-ask is bounded at two attempts (ceiling 16 requests per run for
8 instruments), the attempt count and the first answer's classification are stored
on every sample, and the classification after the last attempt is final: a zero or
crossed spread is still rejected. Conversion legs, fetched cold once per snapshot,
get four attempts 900ms apart for the same reason.

Sampling scope is not the registry and not the stage table — it is exactly the
`telemetry_controls.sampler_symbols` list, floored by the compiled
`MAX_INSTRUMENTS_PER_RUN = 8`. A symbol at a sampling-eligible stage that is absent
from that list is **not** sampled, and the database may lower the ceiling but never
raise it above the compiled value.

The list holds eight instruments: Wave 0 (XAUUSD, GBPAUD, EURUSD) at
`execution_approved`, plus GBPUSD, AUDUSD, USDCAD, USDCHF and USDJPY at
`data_validation`. That is 768 instrument-slots per day, one quote each, no candle
fetches.

Two stage facts do not follow from that list. NAS100 sits at `data_validation`
after being bound to its broker ticker, so it is sampling-eligible by stage, but it
is not in `sampler_symbols` and therefore collects no spread samples; adding it
would require displacing another symbol or raising the compiled ceiling. XAGUSD,
USOIL and UKOIL remain `disabled` and are not sampled.

### Promotion review

The **Promotion checkpoint** panel in Admin Intelligence answers, per instrument,
whether the recorded evidence satisfies the `data_validation -> shadow` gate
documented in [INSTRUMENT-LIFECYCLE.md](INSTRUMENT-LIFECYCLE.md), and names every
unmet criterion beside the measured value. Promotion stays a manual, audited
`transition_instrument_stage` decision taken one instrument at a time, with the
checkpoint output recorded as its evidence. The panel reads the window from the
recorded evidence rather than from a date written here, because a date in prose is
stale the day after it is written.

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
permission to train or promote a model.

Nothing is deleted unless its archive row exists, and learning rows are never
deleted: replay outcomes, research candidates, model observations and
sizing-divergence rows keep an `archived_signal_id` that resolves in the archive.
Archived setups stay exportable as the `archived_signals` training dataset.
Admin → Intelligence → **Data retention health** shows the last run of each
clean-up job with the database's own outcome, so a failing clean-up is visible.

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

**"Work discarded" / queue-throughput fault.** A queued job that is not picked up
within `JOB_STALE_AFTER_MS` (15 minutes) is closed without fetching candles, so no
setup can be published from it. That is a throughput fault, never an absence of
setups, and the freshness rule itself is not to be relaxed — analysing stale prices
would fabricate a setup. Check three things in order:

1. **Database → app calls** in Admin → Engine status. The card names the cause:
   an upstream name-lookup stall (DNS consumed ~all the elapsed time), a plain
   timeout (the handler outstayed the caller's window), or a 5xx (the app errored
   or the platform cancelled a hung request). Scanner-path health is scored from
   `worker_pass_log` — the row each pass writes about itself — against the number
   of drain calls the database made, so a call the platform cancelled counts as a
   scanner failure. It previously read `cron.job_run_details`, which only proves
   the timer's SQL ran and therefore reported zero scanner failures throughout a
   cancellation storm.
2. **Single-flight lease.** `worker/process` takes a TTL lease row
   (`scan_worker_lease`) before working; a second concurrent pass answers "busy"
   and exits. This replaced the pre-work hand-off, which used to fan one timer
   tick into a burst of 10–16 simultaneous passes that strangled each other on
   the provider's 5-request concurrency cap and were cancelled as hung. The TTL
   is 25s and a working pass renews it after every job
   (`renew_scan_worker_lease`), so a cancelled pass — whose cleanup never runs —
   blocks the queue for one timer tick instead of the 90s that produced whole
   hours of discarded work.
3. **Guaranteed response.** One abort signal ends the batch at
   `RESPONSE_DEADLINE_MS` (18s) and propagates through slot waits, retry delays
   and broker fetches. Cleanup settles before the worker releases its lease, so
   no successor overlaps detached work. The local slot gate also has its own
   `MARKET_DATA_WAIT_TIMEOUT_MS` (12s) bound and reclaims expired holders.
4. **Hand-off and guards.** There is no fire-and-forget self-chain. Both drain
   crons run every minute, guarded by
   `EXISTS (pending) OR EXISTS (processing older than 2 minutes)` so expired
   claims also wake the worker, and allow 30s per call. `maintain_scan_queue`
   runs every minute and returns claims older than 2 minutes to pending; a lease
   expiry hands the job its attempt back (a cancellation is not the job's fault)
   and only a job reaching 5 attempts is failed outright.

5. **Market-data concurrency.** Historical reads pass an atomically allocated
   global TTL slot budget (`market_data_slots`, cap 5, mirroring the provider
   limit) inside the per-instance gate. Capacity pressure and provider 429s are
   transient deferrals, never evidence that an instrument is unhealthy. If the
   coordination store is unreadable, the worker fails closed instead of risking
   an overlapping request burst.

`scanner_starvation_incidents` records an open incident and emails the owner while
the fault persists, and clears itself once analysis resumes.

**MetaApi timeout.** Every fetch is wrapped in an 8-second timeout; on expiry the
pair is skipped without changing instrument health, and the scanner advances. Shadow
replay keeps the setup open and leaves its cursor unchanged until a real M15 candle
batch is available. Repeated timeouts on one instrument point at the upstream data
bug, not at the scanner or replay maths.

**Shadow replay degraded.** `DEGRADED` means the latest replay pass was allowed to
run but could not fetch usable provider candles for every attempted instrument.
It is missing data, not a win/loss/no-trade result, and it does not pause live
scan cycles or delivery gates. `BREAKER TRIPPED` means repeated failed replay
passes have entered cooldown.

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

### Provider rate limits

The broker data provider caps concurrent historical market-data reads per
account (5). Three controls keep jobs inside that cap:

- Historical candle reads pass through a shared process-local gate limited to 4
  concurrent requests (`src/lib/metaapi/market-gate.server.ts`).
- A throttled read (HTTP 429) is retried once, waiting for the provider's
  `Retry-After` or a bounded exponential delay capped at 3s. Mutations are never
  retried.
- Market-data-heavy jobs are staggered: scan cycles run every 15 minutes on the
  quarter, spread sampling at minutes 5/20/35/50 and shadow replay at minute 9.

A rate-limited cycle means missing evaluation data for that pass — never "no
setups" and never a scanner-wide No Trade. The shadow replay engine reads
RECOVERING after one failed pass and DEGRADED only once failures repeat.

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
