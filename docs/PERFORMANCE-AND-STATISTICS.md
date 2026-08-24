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
| Wilson score interval           | `src/lib/stats/wilson.ts`                                                                                                               | Proportion intervals; carries `DIAGNOSTIC_ONLY_NOTE`                                                                   |
| Whole-UTC-day cluster bootstrap | `BOOTSTRAP_METHOD = "whole_utc_day_cluster_bootstrap"`, `DEFAULT_REPLICATES = 2000`, `DEFAULT_SEED = 20260821`, `BOOTSTRAP_VERSION = 1` | Dependence-aware intervals: trades from one UTC day are correlated, so whole days are resampled, not individual trades |
| Benjamini–Hochberg              | `src/lib/stats/bh.ts`                                                                                                                   | Multiple-comparison control across buckets; carries `BH_DIAGNOSTIC_NOTE`                                               |

Maturity gates: `MIN_GROUP_SAMPLES = 30`, `MIN_GROUP_CLUSTERS = 10` (equal to
`MIN_CLUSTERS`), practical-effect threshold `PRACTICAL_EFFECT_THRESHOLD = 0.05`.
Below a gate the group is reported as immature. Its raw point estimate may still
be shown as a description of the selected rows, never as an inferential or
forward-looking estimate.

`HOLDOUT_AVAILABLE = false`. There is currently **no** holdout or out-of-sample
validation layer, so every statistic in the app is **descriptive of its sample**,
never predictive. Results below the gates, or lacking cluster support, are labelled
diagnostic-only and are not actionable evidence.

The bootstrap is deterministic: same input, same seed, same interval.

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
- No out-of-sample validation exists yet.
- Self-reported fills flow into personal statistics unchanged; garbage in, garbage
  out, with the author recorded.

## Implementation

`src/lib/performance.ts`, `src/lib/performance-evidence.server.ts`,
`src/lib/stats/wilson.ts`, `bootstrap.ts`, `bh.ts`,
`clusters.ts`, `evidence.ts`, `src/lib/learning/*`, `src/lib/reports/weekly*`.

## Tests

`src/lib/__tests__/performance.test.ts`, `src/lib/stats/__tests__/stats.test.ts`,
`src/lib/learning/__tests__/*`, `src/lib/reports/__tests__/*`.
