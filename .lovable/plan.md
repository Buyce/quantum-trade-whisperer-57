# Live auto-trade readiness — what is done, what is left

## Short answer

No. Roughly the first third of the approved MT4/MT5 plan is built. Live auto-trading is not ready for users, and no live order has ever been proven end to end.

## Verified state (checked this session)

Done:
- Migrations applied: new scanner-settings columns (spread/slippage/percentage exposure/news protection), global and per-account emergency-stop metadata, delivery confirmation metadata, `awaiting_confirmation` delivery state.
- News gate wired into both automatic enqueue and pre-send revalidation, with recorded evaluations and a `news_blackout` refusal reason.
- Admin execution switches read and write emergency-stop fields.

Not done:
- `max_spread_points`, `max_slippage_points`, `max_total_exposure_percent`, `news_protection_enabled` exist as columns but nothing in the enqueue or pre-send path reads them, and Settings has no controls for them. They are inert.
- No `confirmLiveDelivery` / `declineLiveDelivery` server functions; `awaiting_confirmation` is only a colour in the history UI. Nothing enqueues `live_confirm`.
- Reconciliation is still cron-only; none of the event triggers (auto-trading enabled, settings saved, account armed, reconnect success, enqueue failure) call it.
- No customer-facing emergency stop on `/accounts`, no live order queue panel on `/history`, no unified admin account-health / execution-diagnostics panel.
- No live caps, live kill-switch reason, or per-configuration live confirmation identity in use.
- No demo canary evidence, so automatic execution end to end is still unproven.

## Remaining work, in order

1. **Enforce the new user limits.** Read spread, slippage and total-exposure-percent settings in `direct-enqueue.server.ts` (cheap checks) and always again in `revalidate.server.ts` before submission, with distinct refusal reasons. Exposure percent computed from open/resting P-Trades deliveries against broker equity, labelled advisory where broker state is not directly readable.
2. **Safe defaults + Settings UI.** Column defaults for new users (A-grade minimum, 0.5% risk, 1% total exposure, 2 orders/day, 1 concurrent, market entry off, news protection on, no stop widening). Existing rows untouched. Add the controls plus plain-language refusal explanations to Settings.
3. **Event-driven reconciliation.** Call the same bounded `reconcileActiveSignals` path after: automatic trading enabled, relevant settings saved, account armed, account reconcile/reconnect success, enqueue failure. Cron stays as safety net.
4. **Live Confirm infrastructure, built but disabled.** Owner-authenticated confirm/decline server functions, automatic expiry when the window or TIF passes, `live_confirm` enqueue only while `live_execution_enabled` is on (stays false), new controls `customer_live_confirm_enabled` / `customer_live_auto_enabled` / `live_kill_switch_reason` all default false, allow-list rule split so it applies to the external bridge only.
5. **UI and diagnostics.** `/accounts` emergency stop (disarm every account, cancel every claimable delivery). `/history` live order queue panel (confirm/decline, countdown, lot size, cash at risk, margin labelled estimate) — empty while live is off. Admin panel: deployment/connection state, deliveries by state, submissions, fills, reconciliation health, error taxonomy, deployed version.
6. **Tests and verification.** Ceilings, news blocking, event reconciliation, duplicate prevention, live blocking while gates are off, unknown-state no-resubmit, RLS. Then lint, typecheck, full suite, security scan, production build.
7. **Demo canary.** One minimum-volume order on the broker-confirmed demo account, tracked from submission to fill or correct pending state, then closed/cancelled and reconciled from broker evidence. Only after that evidence exists will automatic execution be called functional.

## Live gating stays unchanged

`live_execution_enabled` and `live_auto_enabled` remain off throughout this work. Turning them on later still does not opt any user in: each owner must connect a broker-confirmed real account, arm it to `live_auto`, pass the customer live gate and fresh per-configuration confirmation, pass pre-send revalidation, and be within limits with the kill switch clear.

## Unchanged

Demo auto-trading keeps running. Scanner publication, grading, research/shadow statistics and the zero-fabricated-data rule are untouched.
