# Performance and statistics

## Purpose

Report what a sample of trades produced while separating raw descriptive point
estimates from evidence maturity. Small-sample figures remain visible as an
audit of what was recorded, but the terminal labels the population immature and
does not treat the numbers as decision-support evidence.

## Current behaviour

### Performance Engine (source-separated)

The user chooses exactly one source:

| UI source          | Required provenance          | Included rows                                                                             |
| ------------------ | ---------------------------- | ----------------------------------------------------------------------------------------- |
| My Journal         | **SELF-REPORTED JOURNAL**    | Closed, taken journal entries recorded by the user or assistant                           |
| Broker Account     | **CUSTOMER BROKER EVIDENCE** | Closed deals positively associated with P-Trades orders on that user's connected accounts |
| P-Trades Benchmark | **CONTROLLED BENCHMARK**     | Closed, associated deals from the dedicated P-Trades demo benchmark policy                |

No source falls back to another when empty. Deterministic scanner replay is
research-only and is not a Performance source. Source queries are paginated and
fail closed at their explicit safety bound; a capped subset is never presented as
the complete Performance population.

```text
Expectancy in R = (win rate x average win in R) - (loss rate x average loss in R)
```

plus win rate, average win, average loss, total R, R distribution, per-grade and
per-instrument breakdowns and a time-of-day view. Values are computed on **one
explicitly chosen R basis** at a time; `r_vs_plan` and `r_vs_actual_risk` are
never mixed into one average. Win/loss/breakeven classification follows the sign
of that selected canonical R value. A contradictory self-reported outcome label
remains visible in the journal as provenance but cannot alter Performance win
rate or expectancy.

### Statistical standard (research)

| Method                          | Constant                                                                                                                                | Purpose                                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Wilson score interval           | `wilson()` in `src/lib/baseline/capture.server.ts`                                                                                      | Proportion intervals for baseline fill and win-if-filled rates; correct at small `n`, unlike the normal approximation   |
| Whole-UTC-day cluster bootstrap | `BOOTSTRAP_METHOD = "whole_utc_day_cluster_bootstrap"`, `DEFAULT_REPLICATES = 2000`, `DEFAULT_SEED = 20260821`, `BOOTSTRAP_VERSION = 1` | Dependence-aware intervals: trades from one UTC day are correlated, so whole days are resampled, not individual trades |
| Benjamini–Hochberg              | `src/lib/stats/bh.ts`                                                                                                                   | Multiple-comparison control across buckets; carries `BH_DIAGNOSTIC_NOTE`                                               |

#### The three evidence tiers

`EVIDENCE_TIERS` in `src/lib/stats/evidence.ts` names every floor used anywhere in
research, so a claim can always be traced to the tier that licensed it. There are
exactly three, and no code invents a fourth:

| Tier                    | Samples | Clusters | Cluster unit    | Licenses                                    |
| ----------------------- | ------- | -------- | --------------- | ------------------------------------------- |
| `descriptive`           | 30      | 10       | UTC day         | describing a difference on full history      |
| `chronological_period`  | 30      | 5        | instrument-day  | reading ONE side of a chronological split    |
| `training`              | 200     | 10       | UTC day         | fitting on, not merely describing            |

`chronological_period` counts independence per instrument-day rather than per whole
UTC day because a split period contains fewer whole days by construction.
`MIN_GROUP_SAMPLES = 30` and `MIN_GROUP_CLUSTERS = 10` are the `descriptive` tier's
floors; the practical-effect threshold is `PRACTICAL_EFFECT_THRESHOLD = 0.05`.

Below a tier's floor the group is reported as immature. Its raw point estimate may
still be shown as a description of the selected rows, never as an inferential or
forward-looking estimate.

#### In-sample versus forward

`HOLDOUT_AVAILABLE = false` and this remains true. It refers specifically to a
**forward** holdout: no sample has been accumulated after a decision was taken and
registered as an out-of-sample test of it, so no statistic in the app is
predictive. Every figure is descriptive of its own sample.

The walk-forward layer below is a different and weaker thing: a **chronological
re-split of the same historical population**. It removes the in-sample advantage a
gate gets from being measured on the history that suggested it, which is worth
having, but held-out later days are still recorded history. Both statements are
true at once, and neither upgrades the other.

The bootstrap is deterministic: same input, same seed, same interval.

### Walk-forward (out-of-sample) confirmation

A gate difference measured over all of history is in-sample by construction. The
hourly pass (`src/lib/learning/walk-forward.server.ts`) therefore re-measures each
tunable gate on a **chronological** split of the same research population: the
earlier trading days train, the later days are held out. Nothing from the holdout
period can influence the training period.

A gate is confirmed only when both periods clear the sample and independent
instrument-day cluster floors, the difference keeps the same direction on the
held-out days, is at least 0.05R, and its cluster-robust 95% interval excludes
no-effect. Results are recorded in `walk_forward_confirmations` and shown in
Admin → Intelligence.

`run_gate_change_automation()` now refuses to open OR automatically apply a
threshold change without a fresh confirmation for that gate. A missing, stale or
unreadable confirmation withholds the change — it can never authorise one.

## Inputs

Resolved rows from the selected Performance source on one R basis. Research
estimands separately use broker evidence or replay outcomes with `signal_id` and
whole-UTC-day cluster labels; neither changes the user-facing source boundary.

## Outputs

Point estimates, intervals with their method and version, sample and cluster
counts, maturity verdicts, and plain-language notes.

## Provenance

The source badge and CSV export carry the exact provenance label. CSV also names
`r_vs_plan` or `r_vs_actual_risk`. The bases and sources are never summed,
averaged, filled from one another or silently substituted.

## Failure behaviour

An empty sample renders zeroed/absent metrics plus the reason. An immature sample
renders its raw descriptive arithmetic with an explicit row/day gate status. It
never renders a synthesised row or an example trade.

## User-facing meaning

- Positive expectancy = this sample returned more than it lost, per completed
  trade. It says nothing about the next trade.
- A wide interval = few observations, or few distinct days.
- "Not enough evidence" = a gate was not met.

## What the statistics do not guarantee

- No predictive claim, no statement about future performance.
- No causal claim about why a bucket performed as it did.
- No **forward** out-of-sample validation exists: `HOLDOUT_AVAILABLE = false`. The
  walk-forward layer re-splits recorded history chronologically and is not a
  substitute for a sample gathered after the decision.
- A confirmed gate is a statement about held-out recorded days, not about the next
  trade.
- Self-reported fills flow into personal statistics unchanged; garbage in, garbage
  out, with the author recorded.

## Implementation

`src/lib/performance.ts`, `src/lib/performance-evidence.server.ts`,
`src/lib/stats/bootstrap.ts`, `bh.ts`, `clusters.ts`, `evidence.ts`,
`walk-forward.ts`, `src/lib/baseline/capture.server.ts` (`wilson`),
`src/lib/learning/*`, `src/lib/reports/weekly*`.

## Tests

`src/lib/__tests__/performance.test.ts`, `src/lib/stats/__tests__/stats.test.ts`,
`src/lib/learning/__tests__/*`, `src/lib/reports/__tests__/*`.
