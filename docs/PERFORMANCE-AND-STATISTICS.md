# Performance and statistics

## Purpose

Report what a sample of trades produced, with an evidence standard strong enough
that the terminal will say "not enough evidence" rather than show a number that
cannot support a decision.

## Current behaviour

### Performance Engine (personal)

Built only from the user's own journal:

```text
Expectancy in R = (win rate x average win in R) - (loss rate x average loss in R)
```

plus win rate, average win, average loss, total R, R distribution, per-grade and
per-instrument breakdowns and a time-of-day view. Values are computed on **one
explicitly chosen R basis** at a time; `r_vs_plan` and `r_vs_actual_risk` are
never mixed into one average.

### Statistical standard (research)

| Method | Constant | Purpose |
| --- | --- | --- |
| Wilson score interval | `src/lib/stats/wilson.ts` | Proportion intervals; carries `DIAGNOSTIC_ONLY_NOTE` |
| Whole-UTC-day cluster bootstrap | `BOOTSTRAP_METHOD = "whole_utc_day_cluster_bootstrap"`, `DEFAULT_REPLICATES = 2000`, `DEFAULT_SEED = 20260821`, `BOOTSTRAP_VERSION = 1` | Dependence-aware intervals: trades from one UTC day are correlated, so whole days are resampled, not individual trades |
| Benjamini–Hochberg | `src/lib/stats/bh.ts` | Multiple-comparison control across buckets; carries `BH_DIAGNOSTIC_NOTE` |

Maturity gates: `MIN_GROUP_SAMPLES = 30`, `MIN_GROUP_CLUSTERS = 10` (equal to
`MIN_CLUSTERS`), practical-effect threshold `PRACTICAL_EFFECT_THRESHOLD = 0.05`.
Below a gate the group is reported as immature, not estimated.

`HOLDOUT_AVAILABLE = false`. There is currently **no** holdout or out-of-sample
validation layer, so every statistic in the app is **descriptive of its sample**,
never predictive. Results below the gates, or lacking cluster support, are labelled
diagnostic-only and are not actionable evidence.

The bootstrap is deterministic: same input, same seed, same interval.

## Inputs

Resolved journal rows on one R basis, or replayed research outcomes with their
cohort and UTC-day cluster labels.

## Outputs

Point estimates, intervals with their method and version, sample and cluster
counts, maturity verdicts, and plain-language notes.

## Provenance

Personal performance = **trades you logged**. Scanner baseline = replayed
published setups. The two are computed and displayed separately and are never
summed.

## Failure behaviour

An empty or immature sample renders a zeroed/absent metric plus the reason. It
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

`src/lib/performance.ts`, `src/lib/stats/wilson.ts`, `bootstrap.ts`, `bh.ts`,
`clusters.ts`, `evidence.ts`, `src/lib/learning/*`, `src/lib/reports/weekly*`.

## Tests

`src/lib/__tests__/performance.test.ts`, `src/lib/stats/__tests__/stats.test.ts`,
`src/lib/learning/__tests__/*`, `src/lib/reports/__tests__/*`.
