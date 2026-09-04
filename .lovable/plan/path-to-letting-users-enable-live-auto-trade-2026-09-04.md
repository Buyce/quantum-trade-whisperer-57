# Path to letting users enable live auto-trade

Owner spread, slippage and total-exposure ceilings are now enforced at pre-send,
and each submitted order records its broker-derived risk. The remaining work is
the customer-facing safety surface, the live opt-in chain, and the broker
evidence that proves an order actually reached the market. Live stays OFF until
the last step passes.

## 1. Cheap enqueue-side ceilings + safe defaults

- Read the owner's spread/slippage/exposure settings in the enqueue path too, so
  an order that cannot possibly pass pre-send is refused before it costs a queue
  slot. Pre-send stays the final authority; nothing here relaxes it.
- Column defaults for NEW accounts only (existing rows untouched): A-grade
  minimum, 0.5% risk per trade, 1% total exposure, 2 orders/day, 1 concurrent,
  market entry off, news protection on.

## 2. Settings controls

Add the three ceilings to Settings with plain-language help and the exact refusal
wording each one produces, next to the existing exposure controls.

## 3. Customer emergency stop

On /accounts: one control that disarms every account back to Observe and cancels
every delivery still cancellable. Records who stopped, when and why. Re-arming is
always deliberate and per account.

## 4. Event-driven reconciliation

Call the same bounded reconcile pass after: automatic trading enabled, relevant
settings saved, an account armed, a reconnect/reconcile success, and an enqueue
failure. Cron stays as the safety net.

## 5. Live confirmation, built but gated

- Migration: customer live controls (`customer_live_confirm_enabled`,
  `customer_live_auto_enabled`, `live_kill_switch_reason`) all defaulting to
  false/null, plus live-specific caps.
- Owner-authenticated confirm / decline server functions over
  `awaiting_confirmation` deliveries, with automatic expiry when the order window
  or time-in-force passes.
- `live_confirm` accounts start being enqueued only while live execution is
  enabled — which it is not yet.
- /history gains a live order queue: pending confirmations with countdown, lot
  size, cash at risk, margin labelled as an estimate, and confirm/decline. Empty
  while live is off.

## 6. Admin diagnostics

One panel: connection state per account, deliveries by state, submissions, fills,
reconciliation health, refusal taxonomy, deployed version. So a stuck live order
is visible without a database query.

## 7. Verification, then the demo canary

- Tests: ceilings at both boundaries, news blocking, event reconciliation,
  duplicate prevention, live paths refusing while gates are off, unknown-state
  never resubmitted, confirm/decline ownership, RLS.
- Then lint, typecheck, full suite, security scan, production build.
- Then ONE minimum-volume order on the broker-confirmed demo account, tracked
  from submission to fill (or correct pending state), then closed and reconciled
  from broker evidence.

## 8. Only after that: staged live enablement

1. Turn on `live_execution_enabled` with `customer_live_confirm_enabled` only —
   every live order needs a per-trade confirmation from its owner.
2. Watch a small number of confirmed live orders settle from broker evidence.
3. Only then consider `live_auto_enabled` + `customer_live_auto_enabled`.

Turning the admin switches on never opts a user in. Each owner still has to
connect a broker-confirmed real account, arm it deliberately, pass their own
limits, the news and market gates, and the kill switch.

## Unchanged

Demo auto-trading keeps running throughout. Scanner publication, grading,
research/shadow statistics and the zero-fabricated-data rule are untouched.

## Technical notes

- New columns are additive and nullable/defaulted; no existing row is rewritten.
- Confirm/decline are `requireSupabaseAuth` server functions scoped to the owner
  of the delivery; expiry is service-role and time-based only.
- Emergency stop writes account mode + cancellation through the existing
  admin-verified execution path and bumps `execution_config_version`, so
  in-flight deliveries revalidate against the new state.
- The external webhook bridge and `allowed_live_hosts` remain out of scope: live
  execution here is direct MetaApi only.
