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

Enqueue for an armed broker account happens in the publication path
(`src/lib/delivery/direct-enqueue.server.ts`), not in a database trigger, so it
uses the same `evaluateEligibility` rules as alerts: the owner's instruments,
sessions, `alert_min_grade` and daily cap, counted over the whole UTC-day frame.
C-Grade is never executed, and an owner with no settings row gets no order rather
than a guessed default. Automatic orders therefore never reach an instrument,
session or grade the owner did not select.

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
  `configuration_changed_since_enqueue`. An old signal is never silently sent under
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
`tif_expired`, `quote_unavailable`, `policy_unsupported`,
`configuration_changed_since_enqueue`.

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
`hmac.ts`, `outbound-url.server.ts`, `exposure.ts`, `eligibility.ts`,
`src/lib/execution/direct.server.ts`, `src/lib/evidence/reconcile.server.ts`,
`src/lib/execution.functions.ts`, `src/lib/webhook-test.functions.ts`,
`src/routes/_authenticated/settings.tsx`.

## Tests

`src/lib/delivery/__tests__/execution-safety.test.ts`,
`src/lib/delivery/__tests__/control-plane.test.ts`.
