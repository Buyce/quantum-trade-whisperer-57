# Glossary

Canonical vocabulary. These terms mean exactly this throughout the app, the
documentation and the MCP tools.

## Structure and grading

**ABC structure** — the retracement geometry the scanner looks for: an impulse
(A→B) and a retracement into a decision zone (C).

**Point C** — the liquidity/retest zone where the setup becomes actionable.

**Order block** — an H1/H4 institutional supply/demand zone. Pillar 2 asks whether
Point C lands inside one.

**Pillar** — one of four confluence tests, each scored 0-100: trend alignment,
order block, momentum, volatility expansion. A pillar passes at
`PILLAR_PASS_SCORE` (60).

**Grade** — `A+` (an A structure with all four pillars), `A`, `B`, `C`.

**Confidence score** — a weighted **rule-satisfaction** score (trend 35%, order
block 25%, momentum 20%, volatility expansion 20%), with R:R applied afterwards as
a cap. **Not a win probability.**

**Structure key** — the identity used to suppress republishing the same structure;
a structure may not republish within `STRUCTURE_COOLDOWN_MINUTES` (120).

## Plan

**Trade profile / plan** — direction, entry, stop, targets, R multiples,
confidence and breakdown.

**Maximum acceptable entry** — the worst fill at which entering still preserves the
plan's intent, given the slippage tolerance.

**maxR / capped** — the maximum R reachable before the nearest H4 barrier; `capped`
means that barrier, not the 1:3 default, set the final target.

**TIF (time in force)** — an unfilled pending order is cancelled after
`ORDER_TIF_MINUTES` (30), two M15 candles.

**No Trade** — the default. Zero qualifying setups is a correct outcome and renders
"Capital Preservation Mode Active".

## Delivery

**Feed-eligible** vs **alert-eligible** — separate thresholds. Appearing in the
feed does not imply an alert was or would be sent.

**Daily cap** — a per-user limit on channel-base signals (A+/A/B, ranked by
detection time in the UTC-day frame). `0` = unlimited. C-grade never counts.

**Notification** — tells a system a setup exists. **Execution delivery** — asks a
bridge to place an order. Different paths; the second is disabled by default.

**Dry run** — the full pipeline ran and nothing left the server.
**Sent** — one POST was made. **Acknowledged** — the receiver confirmed; only this
proves acceptance. **Unknown** — the outcome could not be determined and will not
be retried automatically.

## Risk

**R** — one unit of planned risk (the entry-to-stop distance).

**r_vs_plan** — realised move measured against the planned risk distance.

**r_vs_actual_risk** — realised move measured against the risk actually taken from
the actual fill to the actual (or fallback planned) stop.

**Basis** — which of the two is in use. Explicit, never mixed, never averaged
together.

**Stop provenance** — `actual_stop`, `planned_stop_fallback`, or `unavailable`.

**Gross vs net R** — net R exists only when a documented monetary value of 1R was
recorded; otherwise "gross R only".

**Authoritative sizing model** — Model 1 (`static_v1`). Model 2 runs in shadow;
promotion is service-role only.

**Advisory exposure** — derived from trades the user logged. It is not broker state.

**Margin estimate** — a model figure from stated leverage, not a broker quote.

## Measurement

**Expectancy in R** — `(win rate x avg win in R) - (loss rate x avg loss in R)`,
on one explicit basis.

**Cluster bootstrap** — resampling whole UTC days rather than individual trades,
because same-day trades are correlated. Deterministic under a fixed seed.

**Wilson interval** — the proportion interval used for win rates.

**BH adjustment** — Benjamini–Hochberg multiple-comparison control across buckets.

**Mature / immature** — a bucket is mature only at or above `MIN_GROUP_SAMPLES`
(30) and `MIN_GROUP_CLUSTERS` (10). Immature buckets are reported as such.

**Diagnostic-only** — descriptive of the sample, not actionable evidence.

**Holdout** — absent. There is no out-of-sample validation layer.

## Research

**Shadow replay** — deterministic forward test over stored candles under
`single_exit_first_target`. Adverse intrabar ordering is assumed when M15 OHLC
cannot resolve sequence.

**Research candidate** — a structure enrolled *before* the publication decision, so
rejected structures are forward-testable too.

**Cohort** — the isolated group a candidate belongs to; production reads never see
research cohorts.

**Filter lift** — the measured effect of a rejection filter, compared on a common
research ladder. Admin-only.

## Provenance

**Broker-derived**, **engine-derived**, **self-reported**, **replay-derived**,
**estimate** — see [DATA-PROVENANCE.md](DATA-PROVENANCE.md).

**Verified** — never used alone. A value is verified *against a named source*, or
it is self-reported.

**Agent-entered** — written by a connected AI assistant. Permanently stamped.

**Fail closed** — when an input is missing or stale, refuse and name the reason.
Never estimate, default or coalesce to zero.
