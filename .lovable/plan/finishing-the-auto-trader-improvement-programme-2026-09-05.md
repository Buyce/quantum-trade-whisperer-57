# Finishing the auto-trader improvement programme

Confirmed state right now (from reading the code and schema):

- Done and live: broker-derived loss/drawdown brakes; the separation between
  "is this setup worth trading" and "is this account/price good right now".
- Half-built: execution-quality scoring exists (`execution_quality_scores`,
  `execution_cooldowns`, the scoring maths, the evidence reader, the queue-time
  and pre-send cool-down refusals) but nothing recomputes the scores on a
  schedule, nothing shows them, and there are no tests yet — so today the tables
  stay empty and the two refusals can never fire.
- Half-built: the daily-slot ranking hook (`ranker`) exists in the eligibility
  layer but no caller passes one, so slots are still first-come-first-served.
- Not started: adaptive spread/slippage norms, walk-forward validation,
  smarter exits tested in replay.

## Order of execution

### Step 1 — Close the loop on execution quality (highest value, already 70% built)
Add one scheduled recompute (folded into the existing telemetry-rollup job, not
a new job), an Admin panel showing each account/instrument/session score and any
active pause, and tests. Once this lands, the two refusals already wired in
start doing real work.

### Step 2 — Rank the day's order slots by measured expected value
Pass a ranker into the existing hook, built from the cohort evidence that is
already computed. Measured cohorts get the scarce slots first; unmeasured
setups keep their current chronological position and are never pushed ahead.
Reduce-only: ranking changes order, never eligibility.

### Step 3 — Adaptive spread/slippage norms
Reuse the spread statistics already being sampled hourly
(`instrument_spread_stats`), which are currently only used for instrument
promotion. Learn the normal spread per instrument/session and use it to
*tighten* the ceiling when conditions are worse than that instrument's own
normal. Your hard caps are never widened.

### Step 4 — Walk-forward validation
Add a time-split evaluation to the existing statistics layer so any threshold or
gate change must hold up on a later, unseen period before it can be proposed.

### Step 5 — Smarter exits, replay only
Partial exits, runners, break-even and trailing stops need bar-level replay data
that is not stored today. This step adds that capture first and reports results
as research only. Live exit policy stays single-exit-first-target until
out-of-sample evidence beats it.

## How this avoids double work and unused data

- Every step extends something that already exists rather than adding a parallel
  system: the existing rollup job, the existing eligibility ranking hook, the
  existing spread statistics, the existing statistics layer, the existing replay
  engine.
- No new table is created where one already covers the data. Step 3 explicitly
  reuses spread sampling instead of collecting spreads a second time.
- Nothing gets collected without a consumer: each step ships the reader, the
  gate that consumes it, and the panel that shows it in the same step. Step 1
  exists precisely because the previous step left data with no producer or
  viewer.
- New gates can only refuse, never approve, so they cannot conflict with the
  brakes, news, market-hours, duplicate or cap checks already in place.
- Anything unmeasured stays unmeasured — never treated as zero, never guessed.

## Technical notes

- Recompute runs inside `src/routes/api/public/cron/telemetry-rollup.ts`, bounded
  per pass, service-role only; no new pg_cron entry.
- Step 2 supplies `CapRanker` from `cohortRankScore` at the `capSequence` call
  sites; default behaviour with no measured cohort is byte-identical to today.
- Step 3 reads `instrument_spread_stats` and lowers the effective ceiling only;
  owner values in scanner settings remain the absolute maximum.
- Demo-first throughout. Live execution stays gated and untouched. Broker-held
  orders are never silently cancelled.
