# Research and shadow

## Purpose

Measure how the engine's rules would have performed — including structures it
**rejected** — without letting any of that measurement touch what users are shown
or what their personal statistics say.

## Current behaviour

### Shadow replay

Every published setup is forward-tested against real stored candles by a
deterministic replay (`src/lib/execution/replay.ts`), under the named policy
`single_exit_first_target`: one pending order, single exit at the first target.
TP2/TP3 are shown to the trader but are not part of the measured object — measuring
a different strategy from the one the bridge can place would make the two numbers
incomparable.

Replay is intentionally conservative: when one M15 candle contains the entry, the
stop and a target, **the adverse ordering is assumed** and the setup resolves as a
loss, because M15 OHLC cannot reveal intrabar sequence. This is pinned V1
behaviour (see [CHARACTERISATION.md](CHARACTERISATION.md)).

A replay registry pins which replay implementation produced each stored outcome,
and `replay-v2.ts` exists as a non-blocking intended-future variant that never
writes production rows.

### Research candidates

To remove selection bias, structures are enrolled **before** the publication
decision, so the rejected cohort is forward-testable too. Enrolment
(`src/lib/research/enrol-candidates.server.ts`) is idempotent and atomic, runs
behind a toggle, and writes only to research tables. `proposedProfile` is
nullable: a candidate that never became a plan is stored as such rather than
given an invented plan.

Cohorts are compared on a **common research ladder** so filter lift is a fair
comparison, and lift reporting is admin-only. Volatility-regime boundaries are
frozen (`vol_definitions`) so a later regime redefinition cannot silently rewrite
history.

### Isolation

Production reads go through cohort-scoped views, not the research tables. Research
rows never enter feed, alerts, eligibility, the journal or personal performance.
Research standard errors that cannot be computed are stored as `NULL`, not zero.

## Inputs

Detected structures (published and rejected), stored candles, frozen regime
definitions, cohort labels, and the active model version.

## Outputs

Shadow execution outcomes, per-regime fill and outcome statistics, payoff
snapshots and stats, candidate cohorts, and admin-only filter-lift reports.

## Provenance

Deterministic replay over broker candles. No user input, no live broker
execution, no live money.

## Failure behaviour

Insufficient samples or clusters ⇒ the bucket is reported immature rather than
estimated. Missing candles ⇒ the setup stays unresolved rather than being scored.

## User-facing meaning

Research output is labelled research-only and advisory. It describes replayed
history under one fixed policy.

## What research does not guarantee

- It is **not** a live track record and involves no executed orders.
- It does not include spread, commission, swap or slippage beyond what the plan's
  own tolerances encode.
- There is no holdout set, so an apparent edge may be in-sample.
- A promotion of any shadow model to authority is service-role only and has not
  occurred for sizing.

## Implementation

`src/lib/execution/replay.ts`, `replay-v2.ts`, `replay-registry.ts`,
`shadow_resolve.server.ts`, `shadow_worker.server.ts`, `src/lib/research/*`,
`src/lib/learning/*`, `src/components/admin/*`.

## Tests

`src/lib/execution/__tests__/replay.test.ts`, `replay-corrected.test.ts`,
`replay.v2.test.ts`, `candidate-resolver.test.ts`,
`src/test/db/__tests__/candidate-cohort.db.test.ts`,
`src/test/db/__tests__/model-version.db.test.ts`.
