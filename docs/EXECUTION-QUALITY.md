# Execution quality, cooldowns and drawdown brakes

## Purpose

Three independent, reduce-only brakes on **automatic** orders. Each one can refuse
an order; none can authorise one, raise a limit, or place anything. They exist
because a setup being good is not the same as an account being fit to trade it
right now.

| Brake                     | Asks                                                                         | Evidence                              |
| ------------------------- | ---------------------------------------------------------------------------- | ------------------------------------- |
| Drawdown brakes           | Is this account losing beyond the owner's own limits?                        | Closed broker trades, broker equity   |
| Execution-quality scoring | Is this account/instrument/session filling materially worse than it used to? | Closed broker trades, delivery ledger |
| Automatic cooldowns       | Has that degradation been recorded, and is the pause still live?             | `execution_cooldowns`                 |

## Current behaviour

### Drawdown brakes (owner-configured, off by default)

Four limits, each disabled at `0`, all read from the owner's settings by
`readBrakeLimits`: daily realised loss as a percent of equity, weekly realised
loss as a percent of equity, consecutive closed losing trades, and peak-to-current
equity drawdown as a percent of the observed peak.

Only **closed, settled** broker trades count. An open position contributes
nothing. A journal entry contributes nothing. A break-even close (net exactly `0`)
ends a losing run without counting as a loss, because it is neither.

`evaluateBrakes` reports the widest, longest-lasting breach first — equity
drawdown, then weekly, then daily, then consecutive losses — so the owner sees the
most serious reason rather than the first one found. Each breach carries its own
resume boundary:

| Reason                   | Resumes                     |
| ------------------------ | --------------------------- |
| `daily_loss_limit`       | next UTC day, 00:00         |
| `weekly_loss_limit`      | next ISO week, Monday 00:00 |
| `consecutive_loss_limit` | next UTC day, 00:00         |
| `equity_drawdown_limit`  | owner action only           |
| `risk_state_unmeasured`  | owner action only           |

If the closed trades cannot be read, or the broker did not report an equity figure
that a percentage limit needs, the verdict is `risk_state_unmeasured` and orders
are **held**. An account P-Trades cannot measure is not treated as a safe one, and
equity is never assumed or substituted from Settings.

A brake stops **new** orders only. An order already resting or filled at the
broker is never touched; unwinding a live position is the owner's decision at
their broker.

### Execution-quality scoring

Scored per `(account, instrument, session)` dimension, hourly. A recent window of
`RECENT_WINDOW_DAYS = 14` is compared against that same dimension's own earlier
norm window of `NORM_WINDOW_DAYS = 60`. A dimension is **never** compared against
another instrument, another account, or a hardcoded constant, so a naturally
wide-spread instrument is judged against its own history rather than against
EURUSD's.

`scoreWindow` records, for each window: closed sample size, median and 90th
percentile slippage, realised-R sample and average, delivery sample, rejected
count, reject rate, and margin refusals. Slippage is signed in price units, with
positive meaning the broker filled worse.

Sample floors, below which a window says nothing at all:

| Floor                   | Value | Meaning                               |
| ----------------------- | ----- | ------------------------------------- |
| `MIN_RECENT_CLOSED`     | 5     | recent window is otherwise unmeasured |
| `MIN_NORM_CLOSED`       | 10    | no norm exists to breach              |
| `MIN_RECENT_DELIVERIES` | 10    | reject rate says nothing              |

An unmeasured dimension reads `not measured` with the reason spelled out. It never
scores zero and never triggers a cooldown.

### Automatic cooldowns

`evaluateCooldown` breaches on exactly two conditions, both requiring both sides
of the comparison to be measured:

- `slippage_breach` — recent median slippage exceeds the dimension's own norm by
  more than `SLIPPAGE_BREACH_MULTIPLE = 2`.
- `reject_rate_breach` — recent reject rate exceeds the norm by at least
  `REJECT_RATE_BREACH_MARGIN = 0.15` absolute.

A breach writes a row to `execution_cooldowns` pausing that dimension for
`COOLDOWN_HOURS = 24`, after which it is re-tested live.

The pause is asked twice: at automatic enqueue, and again immediately before
submission in `revalidate.server.ts`, so a cooldown written between the two still
holds. It surfaces as the `execution_cooldown` refusal reason.

A cooldown is an **additional** refusal layered on every existing gate, so an
unreadable `execution_cooldowns` table returns `null` and blocks nothing by
itself — it must not veto a trade the rest of the stack already approved. This is
the opposite of the drawdown brakes' fail-closed posture, and deliberately so: a
brake is the owner's own stated loss limit, while a cooldown is an inference from
recorded quality.

### Evidence-ranked daily cap

The per-account daily setup cap decides **how many** setups are delivered. When
cohort evidence is readable, an optional `CapRanker` decides **which** ones, and
never how many.

`capSequence` first builds the strict chronological, base-eligible sequence for
the UTC day. A ranker then reorders it stably: the chronological index remains the
tie-break, so equal scores and unmeasured setups keep exactly the order they had.
An unmeasured setup can never outrank a measured one.

The production ranker scores `instrument x direction x session` cohorts from
resolved replay outcomes via `loadCohortEvidence` and `cohortRankScore`. It is
reduce-only and evidence-bound: it demotes only a cohort whose entire 95%
cluster-robust interval sits below zero. A thin, unmeasured or inconclusive cohort
is untouched, and an unreadable history installs no ranker at all, leaving the
sequence purely chronological.

## Inputs

Owner limits and settings; closed broker deals with their settled net, currency
and close time; broker-reported equity and the highest equity observed for the
account; the delivery ledger's states and reject reasons; resolved replay cohort
outcomes for the ranker.

## Outputs

A brake verdict with reason, plain-language detail and resume boundary; per-window
dimension scores with sample counts and an explicit unmeasured reason; cooldown
rows with reason, detail and `resume_after`; a reordered — never resized — cap
sequence. All three surface in Admin → Intelligence.

## Provenance

Brake and cooldown inputs are **broker-derived** (closed deals, broker equity) or
**engine-derived** (the delivery ledger P-Trades wrote itself). Limits are
**owner-configured**. Ranker scores are **replay-derived** and research-grade.
Nothing here reads the self-reported journal, and no missing broker figure is ever
filled from Settings equity.

## Failure behaviour

Unreadable closed trades or a missing broker equity figure pause automatic orders
with `risk_state_unmeasured`. A window below its sample floor reads `not measured`
with the floor named. An unreadable cooldown table refuses nothing. An unreadable
cohort history installs no ranker.

## User-facing meaning

- A brake means "your own stated limit was reached on closed broker trades".
- `not measured` means there is too little recorded fact — not that the dimension
  is healthy, and not zero.
- A cooldown means "this account, instrument and session recently filled
  materially worse than it used to"; it is not a claim about the instrument in
  general or about any other account.

## What these brakes do not guarantee

- They do not predict a loss and are not a forecast.
- They do not cancel, close or modify anything already at the broker.
- They cannot authorise an order, widen a limit, or arm execution.
- A brake that has not fired is not evidence that risk is absent — an unmeasured
  account is held, not blessed.
- Cooldown thresholds are operator-chosen comparison rules, not statistical tests;
  no p-value or interval is claimed for them.

## Implementation

`src/lib/risk/brakes.ts`, `src/lib/risk/brakes.server.ts`,
`src/lib/execution/quality.ts`, `src/lib/execution/quality.server.ts`,
`src/lib/delivery/eligibility.ts` (`CapRanker`, `capSequence`, `buildCapFrame`),
`src/lib/delivery/direct-enqueue.server.ts`,
`src/lib/delivery/revalidate.server.ts`,
`src/components/admin/ExecutionQualityPanel.tsx`.

## Tests

`src/lib/risk/__tests__/brakes.test.ts`,
`src/lib/execution/__tests__/quality.test.ts`,
`src/lib/delivery/__tests__/cap-ranking.test.ts`.
