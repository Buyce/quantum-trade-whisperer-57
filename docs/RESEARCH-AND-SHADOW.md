# Research and shadow

## Purpose

Measure how the engine's rules would have performed — including structures it
**rejected** — without letting any of that measurement touch what users are shown
or what their personal statistics say.

## Current behaviour

### Shadow replay

Every published setup is forward-tested against real stored candles. The currently
frozen production labeller is Replay V1 (`src/lib/execution/replay.ts`) under
`legacy_best_target_touched`: if one bar touches several targets it credits the
deepest, even though direct/bridge execution uses a single exit at TP1. V1 also
tests fill before its TIF deadline, keeps planned-risk normalisation after a gap
fill and fixes every stop loss at `-1R`. Those are characterised historical
semantics, not endorsements (see [CHARACTERISATION.md](CHARACTERISATION.md)).

Replay V2 (`src/lib/execution/replay-v2.ts`) is the corrected research labeller
under `single_exit_first_target`. It checks TIF before fill, uses actual fill-to-stop
risk, records adverse gaps and treats unresolved M15 intrabar order conservatively.
It has a distinct replay version and never overwrites or masquerades as V1. The
replay registry pins the implementation, policy and hash for every stored outcome.

### Exit variants (replay only)

Replay V2 also records the ordered post-fill path of every filled setup in R
units (`shadow_executions.post_entry_path`, bounded to 400 M15 bars). That record
exists so alternative exit rules — half out at the first target with a runner,
stop to break-even after 1R, and a 1R trailing stop — can be simulated against
the *same* path as the live single-exit policy instead of being reported as "not
decidable". `src/lib/execution/exit-variants.ts` does the simulation, purely and
with no I/O; the hourly pass in `src/lib/learning/exit-variants.server.ts` pairs
each variant against the baseline, computes cluster-robust means and reuses the
walk-forward evaluator for an out-of-sample check, then records
`exit_variant_results`.

A setup only enters a variant's sample when the recorded path decides both the
baseline and that variant. A candle in which a favourable and an adverse barrier
are both crossed, or whose internal event order is unknowable, is counted as
undecidable and excluded — never resolved favourably, never unfavourably. A path
that ends with the position open is undecidable too: no closing price is invented.
Live execution stays `single_exit_first_target`; nothing in this surface can
promote a variant.

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
rows never enter feed, alerts, eligibility, the journal or any Performance
evidence source.
Research standard errors that cannot be computed are stored as `NULL`, not zero.

Consented customer broker evidence is a separate research input. Consent defaults
off, is versioned and timestamped, and future inclusion stops on withdrawal. The
research surface receives only a random pseudonymous reference. Estimands cluster
by `signal_id` and whole UTC day; customer, benchmark and replay populations retain
their evidence-class boundary.

## Inputs

Detected structures (published and rejected), stored candles, frozen regime
definitions, cohort labels, and the active model version.

## Outputs

Shadow execution outcomes, per-regime fill and outcome statistics, payoff
snapshots and stats, candidate cohorts, and admin-only filter-lift reports.

## Provenance

Deterministic replay over broker candles. No user input, no live broker
execution, no live money. Every comparison must name both replay version and
execution policy; V1 and V2 results are never one population.

## Failure behaviour

Insufficient samples or clusters ⇒ the bucket is reported immature rather than
estimated. Missing candles ⇒ the setup stays unresolved rather than being scored.
Replay fetches use bounded M15 windows sized from each open row's cursor/detection
time; if the provider times out or returns no usable candles, no cursor is advanced
and no outcome is inferred.

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
`exit-variants.ts`, `src/lib/learning/exit-variants.server.ts`,
`shadow_resolve.server.ts`, `shadow_worker.server.ts`, `src/lib/research/*`,
`src/lib/learning/*`, `src/components/admin/*`.

## Tests

`src/lib/execution/__tests__/replay.test.ts`, `replay-corrected.test.ts`,
`exit-variants.test.ts`,
`replay.v2.test.ts`, `candidate-resolver.test.ts`,
`src/test/db/__tests__/candidate-cohort.db.test.ts`,
`src/test/db/__tests__/model-version.db.test.ts`.
