# Execution and delivery

## Purpose

Optionally deliver an alert-eligible setup to an approved external bridge or an
explicitly connected MetaTrader account, as a financial control plane: every step
is authorised, revalidated and recorded, and the default state is that nothing
goes out.

**Two separate things exist and must not be confused:**

|         | Notification webhook                         | Execution delivery                |
| ------- | -------------------------------------------- | --------------------------------- |
| Purpose | tells a system a setup exists                | asks a bridge to place an order   |
| Path    | notification fan-out (email/push equivalent) | `execution_deliveries` queue only |
| Default | user-configurable                            | globally disabled                 |

The legacy path that sent broker instructions directly from the scanner's alert
fan-out has been **removed**. `src/lib/scanner/alerts.server.ts` is notification-only.

## Current behaviour

### The pipeline

```text
enqueue  -> execution_deliveries (pending, config version snapshotted)
claim    -> only `pending` is claimable
revalidate -> controls, policy, alert eligibility, signal still active, TIF, quote
quantity -> authoritative Prompt-12 sizing lots, checked against min/max/step
SSRF     -> validateOutboundUrl() immediately before the request
signature-> HMAC-SHA256 v2 over the payload
dispatch -> ONE POST attempt, redirect: "manual"
```

A `metaapi_direct` destination follows the same ledger and revalidation boundary,
then uses the connected account's broker-reported classification, symbol map,
equity and volume specification. It does not bypass the queue because it is a
broker connection.

### Which setups reach an armed account

Enqueue for an armed broker account happens in `direct-enqueue.server.ts`, not in a
database trigger, and it is attempted from **two** places: the publication path, and
the active-signal reconciler below. Both call the same function, so it
uses the same `evaluateEligibility` rules as alerts: the owner's instruments,
sessions, `alert_min_grade` and daily cap, counted over the whole UTC-day frame.
C-Grade is refused unless the owner has explicitly switched on
`scanner_settings.auto_execute_c_grade` (default off, in _Rules, alerts &
automatic orders_) **and** their alert tier already includes C; the opt-in bypasses
nothing else, and C-Grade never consumes the daily setup cap. An owner with no
settings row gets no order rather than a guessed default. Automatic orders therefore never reach an instrument,
session or grade the owner did not select.

### Active-signal reconciliation

Publication is a single instant, and an owner's execution readiness is not. Arming
an account a minute after a setup published, reconnecting a broker, correcting an
instrument list, or a worker being briefly unavailable all used to mean the setup
stayed active and valid forever with **no order and no second attempt**. The
reconciler (`src/lib/delivery/reconcile-active.server.ts`, worker route
`/api/public/worker/reconcile-active`) is that second attempt, and every later one.

It is not a second rule set. It selects still-entryable active signals — status
`active`, not expired, and still inside the owner's automatic-order window — ranks
them the way the feed already reads (grade first, then newest, with a stable id
tie-breaker), bounds the pass, and hands each to the same authoritative enqueue path,
leaving the same decision trail. Idempotency is
database-backed: deliveries upsert on `(user_id, signal_id, bridge_profile)` with
duplicates ignored, so repeated passes and concurrent workers cannot double-order.
It reads no alert state — a missed alert never blocks an order and a delivered alert
never authorises one — and it submits nothing to a broker: the dispatcher still does
that, after its own pre-send revalidation.

### Order ceilings

Three independent, owner-set ceilings bound automatic orders.

`scanner_settings.maximum_concurrent_signal_orders` (0-10, default 3) caps how many
automatic orders may be **unresolved at once** — `pending`, `claimed`, `sent`,
`acknowledged` and `unknown` deliveries — and falls again as orders resolve.
`scanner_settings.maximum_daily_signal_orders` (0-25, default 10) caps how many were
**created in the current UTC day** and does not fall when an order closes. The legacy
`maximum_active_signal_orders` column is retained for history only and was backfilled
into both.

Both are **ceilings, never quotas**: reaching one refuses further orders
(`concurrent_order_limit_reached`, `daily_order_limit_reached`), and being below one
is never a reason to place an order. Dry-run rows reach no broker and spend neither.
A count that cannot be read fails closed (`active_order_count_unreadable`). They sit
on top of — never instead of — the daily setup cap, risk per trade, lot ceiling and
exposure limit.

`scanner_settings.maximum_daily_orders_per_symbol` (0-25, default 25) caps how many
automatic orders **one instrument** may consume in the current UTC day
(`instrument_daily_order_limit_reached`), so a single busy instrument cannot spend the
whole daily ceiling. It sits inside the daily ceiling and can only refuse.

### Freshness-adaptive ceilings (opt-in)

`scanner_settings.adaptive_order_ceilings_enabled` (default false). When on, the daily
and per-instrument ceilings move **between the owner's own numbers** according to how
fresh the broker facts an order would be sized from are: the armed account's equity
observation, and the last known destination quote time when one is available.

- `healthy` — equity observed within half of `BROKER_EQUITY_MAX_AGE_MS` (and any known
  quote within `REVALIDATION_QUOTE_MAX_AGE_MS`): the ceiling is raised toward
  `adaptive_order_ceiling_max`, never above it and never above the hard bound of 25.
- `degraded` / `unknown` — an old reading, or no readable reading at all: the ceiling
  is reduced toward `adaptive_order_ceiling_floor`, never above the fixed base.
  Absence of evidence is never room to trade more.

A ceiling the owner set to 0 stays 0 in every direction. Freshness describes **our
data**, not the market, and adaptive mode relaxes no safety gate, changes no sizing
mathematics and authorises nothing — every decision records the ceiling and the
freshness reading that applied.

### Retrying momentary failures

Pre-send revalidation refusals split in two. A **momentary market condition** —
`quote_unavailable`, `quote_stale`, `spread_too_wide`, `market_closed`,
`account_refresh_unavailable`, `limit_price_not_on_pending_side`,
`price_beyond_max_acceptable_entry` — returns the claimed row to `pending`, bounded
by `MAX_DELIVERY_ATTEMPTS`, so the next dispatch pass may try again until the owner's
window ends. Every other refusal, and every safety refusal, is **terminal**. A `sent`
or `unknown` row is still never re-attempted.

### The final look

`claim_execution_delivery` hands back the pending delivery whose owner window closes
**soonest**, so the end of a window is never lost to queue position. Within
`FINAL_LOOK_TAIL_MS` (2 minutes) of that deadline the pass is recorded on the row as
`final_look_at` / `final_look_reason`. Every attempt already forces a fresh
destination-account refresh and a fresh broker quote — revalidation caches no price
and reuses no stored equity — so the last look is a genuine re-check, not a replay.
Once the window has **elapsed** a retryable refusal is settled instead of re-queued:
the window is never extended.

### Market entry (opt-in)

`scanner_settings.auto_market_entry_enabled` (default false). When a setup is still
valid but price has already moved through the planned entry, a resting limit is
impossible. With the owner's opt-in, and **only while the live price is still inside
the published maximum acceptable entry**, the order is submitted at market instead:
geometry and sizing are recomputed from the market reference price, so the stop
distance and lot size describe the fill, not the plan. It widens no ceiling — past
maximum acceptable entry the order is still refused — and research and replay
statistics continue to describe the pending-limit strategy only.

### Unmeasured regimes (opt-in)

`scanner_settings.allow_unmeasured_intel` (default false) applies only while the
intelligence gate is on. By default a regime with too few resolved replay samples
refuses (`intelligence_gate_sample_insufficient`). With the opt-in it passes
(`intelligence_gate_unmeasured_allowed`), while a **measured** win-if-filled rate
below the owner's threshold still refuses. An unmeasured regime is a missing
measurement, not a favourable one.

### Scheduled armed-account refresh

Sizing requires a broker equity observation newer than `BROKER_EQUITY_MAX_AGE_MS`
(15 minutes). `/api/public/cron/refresh-accounts` (every five minutes, bounded to
`REFRESH_MAX_ACCOUNTS` armed accounts, oldest observation first) keeps those stored
figures warm. It authorises and submits nothing; the fresh pre-send preflight remains
the authority for every order and still fails closed when the broker does not answer.

### Automatic-order window

`scanner_settings.auto_order_window_minutes` (0-360, default 180) is how long after
**detection** a published setup may still become an automatic order. `0` disables
automatic orders on age grounds entirely; the maximum is six hours. A setup older
than the owner's window is refused before anything reaches a broker
(`execution_window_expired` at enqueue, `tif_expired` at pre-send revalidation), and
a pending order placed inside the window carries an expiry at the end of it. The
shared pre-settings prune uses only the widest supported window, so it can never
discard a setup some owner is still entitled to act on.

This window is **separate** from the structural `ORDER_TIF_MINUTES = 30`, which
replay, shadow resolution, research and grading mathematics use. Changing the window
changes only what P-Trades will place for that owner; it does not move any
statistic, grade or historical comparison. The window widens nothing else: tier,
instruments, sessions, risk, lot ceiling, exposure limit, the intelligence gate and
the pre-send broker re-check all still decide independently.



On top of eligibility there is one optional, off-by-default, reduce-only rule:
the **intelligence gate** (`src/lib/delivery/intel-gate.ts`). When an owner sets a
minimum win-if-filled rate, an eligible setup only becomes an order if the
replay-derived `regime_stats` rate for its own regime meets that threshold with at
least the configured number of filled samples behind it. A regime with too few
resolved samples — or unreadable statistics — is **refused, not passed**: the gate
fails closed and its refusal is recorded as a missing measurement, never as a
forecast. The gate governs automatic orders only; it never touches the feed,
alerts, grading, replay or any statistic.

Every enqueue decision, including each refusal and each system-wide refusal, is
recorded in `execution_enqueue_decisions` (`enqueue-log.server.ts`, best-effort so
a diagnostic write can never affect a publish). This is why an empty delivery
ledger is unambiguous: either a decision exists and says why, or the engine
published nothing. The owner sees their own decisions in Settings; the admin
terminal sees the recent decisions pseudonymously.

An active setup older than the automatic-order window is recorded as
`execution_window_expired` before any delivery row is created. The dispatcher still
keeps its own `tif_expired` safety net for orders that were fresh at enqueue time but
became stale before dispatch.

### States

`pending` → `claimed` → one of `sent`, `acknowledged`, `rejected`, `unknown`,
`failed`.

`isClaimable` is true only for `pending`. A `sent` or `unknown` row is **never**
automatically re-attempted: an unacknowledged POST may already have created a
broker order, so an automatic retry is exactly how a bridge double-fires.
Resolution of those states is manual or dry-run.

### Safety locks

- **Globally disabled by default.** `live_execution_enabled = false` prohibits
  outbound live POSTs but does **not** stop the dry-run validation pipeline, so a
  user can prove their configuration end-to-end with zero outbound requests.
- **Unreadable controls fail closed.**
- **Observe first.** Connected accounts begin in `observe`. Demo auto requires a
  broker-confirmed demo account, explicit account arming and the global demo gate.
  Real accounts require their independent live gates; demo intent is never enough.
- **Explicit live confirmation.** Arming live requires an owner confirmation that
  names the destination host, the execution policy and the position-sizing basis,
  and states that eligible signals may create broker orders. The confirmation is
  pinned to the configuration version and to system-wide availability; a global
  live enable after an earlier dry-run configuration requires a fresh confirmation.
- **Configuration binding.** A monotonic `execution_config_version` on
  `scanner_settings` is bumped by trigger whenever anything affecting authorisation
  changes — endpoint URL, bridge format, credential identity, execution policy,
  dry/live authorisation, risk inputs that determine quantity, and the eligibility
  settings `instruments`, `sessions`, `alert_min_grade`, `daily_setup_cap`. The
  version is snapshotted at enqueue; at dispatch a mismatch is rejected with
  `configuration_changed_since_enqueue`, `intelligence_gate_below_threshold`,
  `intelligence_gate_sample_insufficient`. An old signal is never silently sent under
  new authorisation.
- **Server-only authorisation writes.** Database column privileges prevent an
  authenticated browser/REST client from reading or replacing the bridge secret
  or writing URL-validation, dry/live, configuration-version and live-confirmation
  fields directly. Those fields are changed only by the authenticated server
  function after its validation and confirmation checks.
- **Named policy.** `single_exit_first_target` — one pending order exiting at the
  first target. Any other policy value is rejected as `policy_unsupported`.
- **Authoritative quantity.** Bridge orders carry the authoritative sizing result.
  Direct connected-account orders are sized from fresh broker equity and that
  account's broker specification, then checked against broker min/max/step. No
  amount is invented when sizing is unavailable.
- **Bridge formats.** The JSON receiver contract is verified and can carry an
  explicit quantity, so it is eligible for automatic live execution.
  **PineConnector remains dry-run only** for automatic execution because its
  quantity/risk field contract is not verified; its sizing syntax is not guessed.
- **Live-host allow-list is owner-managed and fails closed.** A live POST may only
  go to a host on `execution_controls.allowed_live_hosts`. Live execution cannot be
  enabled while `force_dry_run` is on or while the list is empty, automatic live
  orders cannot be armed unless live execution is already on, and removing the last
  allowed host disarms both. Hosts must be plain lowercase hostnames — a URL, path,
  port or wildcard is rejected on save.
- **Live-host allow-list** plus server-side URL validation at both save and
  dispatch, and `redirect: "manual"` everywhere.
- **Connectivity test.** The test webhook validates the URL immediately before the
  request and sends a clearly non-executable `event: "test"` payload to JSON
  receivers. PineConnector's test is a local preview with zero outbound POSTs — a
  real `buylimit`/`selllimit` is never sent as a connectivity check.
- **Exposure is advisory by default.** Logged-trades exposure never blocks unless
  the user opts in (`exposure_limit_enabled`), and the wording always says the
  figure is based solely on trades they logged.
- **Account exposure is separate.** A connected account may have an owner-set
  boundary checked against broker-reported open positions and pending orders. A
  failed broker read refuses submission; it never assumes zero.
- **Isolation.** An execution failure can never interrupt the scanner, the feed,
  research enrolment or any statistic.

## Inputs

An alert-eligible active signal, the user's execution controls and bridge
configuration, the authoritative sizing result, and a fresh quote.

## Outputs

A delivery row with its state, reason, signed payload metadata and configuration
version; and at most one outbound POST.

## Provenance

Quantity provenance (`lots`, model, spec source) is explicit in the payload.
Acknowledgement state is whatever the receiver actually returned.

## Failure behaviour

Every refusal has a named reason, including
`live_execution_globally_disabled`, `user_execution_disabled`, `bridge_disabled`,
`instrument_disabled`, `webhook_not_configured`, `webhook_not_validated`,
`endpoint_rejected`, `not_alert_eligible`, `signal_missing`, `signal_not_active`,
`execution_window_expired`, `tif_expired`, `quote_unavailable`, `policy_unsupported`,
`limit_price_not_on_pending_side`, `limit_distance_unavailable`,
`configuration_changed_since_enqueue`, `intelligence_gate_below_threshold`,
`intelligence_gate_sample_insufficient`.

### Pending-limit price validation

P-Trades submits **pending limit orders only**. A pending limit is therefore
validated on its own terms, twice — once on published geometry and again on the
snapped geometry that will actually be submitted:

- the market must still be strictly on the far side of the planned entry (ask
  above a buy limit, bid below a sell limit), and
- for a connected broker account, at least the broker's own published minimum
  order distance away. That distance is **read, never assumed**: an unreadable or
  absent distance on a direct destination is refused as
  `limit_distance_unavailable`.

The do-not-chase ceiling (`max_acceptable_entry`,
`price_beyond_max_acceptable_entry`) remains the **market-entry** rule, which is
what the feed and the alerts state. It is not applied to a resting limit, because
a market that has run away above a buy limit cannot produce a worse fill — the
order simply waits, and can only ever fill at the planned price or better.

A refusal recorded before submission is a P-Trades refusal, not a broker verdict.
History labels those rows "Not sent — refused by P-Trades" with the plain-language
reason, and reserves "Rejected by broker" for rows that carry a broker return code
or a recorded submission.

## Performance accounting

Automatic broker orders are accounted for separately from the self-reported journal.
Delivery rows describe attempts and whether an order reached the broker boundary;
`broker_trade_evidence` is the only source for broker-confirmed open/closed outcomes.
A P-Trades refusal, a dry run, or a missing broker match is not counted as a taken
broker trade and cannot become a broker win or loss. A closed automatic order enters
Broker Account Performance only when the reconciler positively associates broker
evidence and the selected canonical R basis is present.

## User-facing meaning

- **Dry run** — the whole pipeline ran and nothing left the server.
- **Sent** — one POST was made. It does not mean the bridge accepted it.
- **Acknowledged** — the receiver confirmed. Only this proves acceptance.
- **Unknown** — the outcome of the POST could not be determined. It will not be
  retried automatically, and it may or may not have created a broker order.

## What execution does not guarantee

That a bridge or broker accepted, filled, or is still holding an order, unless a
named acknowledgement or reconciled broker-evidence row proves that state. An
external bridge cannot read broker state; a connected MetaTrader destination can
read only the facts the provider returns, and missing facts remain unavailable.

## Implementation

`src/lib/delivery/execution.ts`, `revalidate.server.ts`, `dispatch.server.ts`,
`direct-enqueue.server.ts`, `intel-gate.ts`, `enqueue-log.ts`,
`hmac.ts`, `outbound-url.server.ts`, `exposure.ts`, `eligibility.ts`,
`src/lib/execution/direct.server.ts`, `src/lib/evidence/reconcile.server.ts`,
`src/lib/execution.functions.ts`, `src/lib/webhook-test.functions.ts`,
`src/routes/_authenticated/settings.tsx`.

## Tests

`src/lib/delivery/__tests__/execution-safety.test.ts`,
`src/lib/delivery/__tests__/control-plane.test.ts`,
`src/lib/delivery/__tests__/direct-enqueue.test.ts`,
`src/lib/delivery/__tests__/intel-gate.test.ts`.
