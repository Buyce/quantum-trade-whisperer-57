# Risk Guardian

Risk Guardian represents drawdown trackers supported by the connected broker
telemetry provider. Availability is an observed feature flag, not assumed.

When supported, tracker breaches are stored with the vendor event time, relative
drawdown when supplied, absolute drawdown when supplied and the original payload.
Missing figures remain `null`; no breach count or drawdown value is fabricated.
Repeated vendor events are deduplicated by tracker and fingerprint.

When unsupported, the account view shows the recorded reason. Risk Guardian is a
monitoring surface, not a substitute for the execution ledger's pre-submit
exposure and sizing checks. It cannot prove that no unreported broker loss or
position exists.

## Provenance

Tracker availability, breach events, drawdown figures and event times all come from
the broker telemetry provider and are stored as broker-derived with the vendor's
event time. Deduplication is engine-derived; no drawdown value is ever inferred.

## Explicit non-guarantees

- Silence is not safety: no recorded breach does not prove no risk was taken.
- Risk Guardian observes after the broker acts; it is not a pre-submit safeguard.
- Missing relative or absolute drawdown stays `null` rather than resolving to zero.

## Tests

`src/lib/telemetry/__tests__/*`, `src/test/__tests__/docs-contract.test.ts`.

## Implementation

`src/lib/telemetry/guardian.server.ts`,
`src/lib/telemetry/guardian-pass.server.ts`, `src/lib/accounts/read.server.ts`.

## Releasing a stored hold

An automatic-order hold is stored per connected account. It is released as soon as
its owner configures no limit at all — protection switched off, or every limit left
at zero:

- The evaluator writes a cleared record (not paused, no reason, no release time,
  cancellation counters back to zero) instead of skipping the account. Peak-equity
  history is an observation and is never overwritten by that clearing write.
- The hold read used by the banner and the feed only reports a stored hold while
  the caller's protection is still configured, so the notice disappears on save
  rather than at the old release time.

Clearing a hold never places, cancels or modifies anything at the broker, and never
loosens a limit that is still configured.

## Cancelling matching unfilled orders when a losing-run pause starts

This is always on and has no setting. When a consecutive-loss pause transitions
from off to on, the evaluator cancels the account's still-unfilled orders whose
instrument and direction match the losses that triggered the pause:

- Filled or partially filled orders and open positions are never touched.
- Matching is fail-closed: a delivery with no readable instrument or direction is
  left alone rather than guessed at.
- Only broker-confirmed cancellations are counted as cancelled; anything else is
  reported as unconfirmed. Both counts surface in the hold notice.

## Correlated-cluster brake — how much of the same bet may be live

Several separate setups on the same instrument in the same direction are not
independent trades. On 2026-09-09 one account held seven distinct XAUUSD short
setups at the same time; gold rose and every one of them closed at roughly -1R.
Duplicate prevention was correct to stay silent — each order had its own planned
entry — and the daily and per-instrument ceilings count orders per day, not
concurrent exposure on one bet. Two customer-owned rules close that gap, both
evaluated at enqueue and both refuse-only:

- **Same bet at once** (`scanner_settings.max_same_bet_orders`) — how many
  UNRESOLVED automatic orders may be live on the same instrument in the same
  direction. Default `1`, raisable only to `2` or `3`; there is no "off". Raising
  it shows an escalating warning, because N live same-bet orders risk about N×
  the amount sized for a single trade. Counted from the same unresolved-delivery
  ledger the concurrent ceiling already uses.
- **Cool-off after a loss on the same bet**
  (`scanner_settings.same_bet_cooldown_minutes`) — after a trade on that
  instrument and direction closes at a loss at the broker, new automatic orders
  on that bet are refused for 30, 60 (default) or 120 minutes, or never when the
  owner switches it off (which warns). Only closed rows in
  `broker_trade_evidence` with a readable close time and a negative net result
  (`gross_profit + commission + swap`) start it — never an estimate, never an
  open position.

Both fail closed towards allowing the order: an unreadable instrument, direction
or loss history is never counted and never refuses, because a refusal must rest
on a fact actually held. Neither rule closes, moves or cancels anything already
at the broker; refusals appear in the feed as `same_bet_limit_reached` and
`same_bet_cooldown_active`.

## Per-cohort automatic-trading rule — which pair and side may trade

A customer may decide, for each instrument AND direction separately, whether
automatic orders are placed at their normal risk, placed with a smaller share of
it, or not placed at all. Rows live in `public.auto_cohort_policies`
(`user_id, instrument, direction, policy, risk_share_percent`), one row per
cohort the owner actually changed, owner-scoped by RLS.

- `block` refuses the order at enqueue (`cohort_blocked_by_user` in the decision
  ledger) and again at send time as the reject reason of the same name, so a rule
  saved after a delivery was queued is still honoured.
- `reduce` multiplies the owner's normal per-trade risk percentage by
  `risk_share_percent / 100` (25%, 50% or 75% in the UI, clamped to 1–100
  everywhere) inside the same broker-derived sizing service the terminal uses.
- No row, an unreadable row, an unrecognised value, or a setup whose direction is
  unknown all mean **allow**: a preference we do not hold can never refuse an
  order and can never resize one.

Reduce-only by construction: the rule may refuse or shrink and can do nothing
else. It never causes an order, never raises a risk percentage, and never touches
the feed, alerts, publication, grading, replay, shadow enrolment or any
statistic. Benchmark deliveries read the operator benchmark policy only and are
never governed by a customer's cohort rules.

The Settings table shows the measured expected return per cohort next to each
control. That figure is a record of whole published plans already measured —
including plans that never traded, counted as 0R — and is never a forecast.

Helper: `src/lib/delivery/cohort-policy.ts` (pure).
Enqueue: `src/lib/delivery/direct-enqueue.server.ts`.
Pre-send: `src/lib/delivery/revalidate.server.ts`, `src/lib/sizing/service.server.ts`.
UI: `src/components/CohortPolicyControls.tsx`, `src/lib/execution.functions.ts`.
Tests: `src/lib/delivery/__tests__/cohort-policy.test.ts`.
