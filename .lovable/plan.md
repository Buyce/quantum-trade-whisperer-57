# Corrections: remove EIA, FRED-only news, and execute active signals

## What the audit found (verified, not assumed)

- HEAD is `88b9cf8` ("Activated news pipeline"), clean tree.
- **EIA did land.** `src/lib/news/providers/eia.server.ts` exists, the cron route `src/routes/api/public/cron/ingest-news.ts` runs an `eia_weekly_stocks` job, `EIA_API_KEY` is referenced in `src/lib/news/ingest.server.ts`, and EIA is described in `docs/NEWS-AND-EVENTS.md`, `docs/MULTI-ASSET.md` and the news audit. Live calls return `API_KEY_INVALID`, so no EIA event row exists.
- **FRED is real and working** (46 ingested events, date-only precision, coverage `timestamp_incomplete`). Nothing needs rebuilding here beyond honesty and a credential rotation gate.
- **Root cause of missed automatic orders is confirmed in code.** `enqueueDirectDeliveries` has exactly one caller: `src/lib/scanner/pipeline.server.ts` line 859, inline immediately after a signal is published. There is no other trigger anywhere in the codebase. So automatic execution is a one-shot, publish-time event: if the user's arming, account connection, settings or the worker were not already correct in that single moment, the signal stays active and valid forever with no order and no second attempt. Reconnects, settings changes, retryable failures and worker downtime all produce permanently missed trades.
- Delivery identity already exists: `execution_deliveries` unique on `(user_id, signal_id, bridge_profile)` — reusable as the reconciler's idempotency key.
- Feed ordering today is `detected_at desc` (`src/lib/queries.ts`); cap ranking is `capSequence` in `src/lib/delivery/eligibility.ts`.
- `scanner_settings` has no per-user active-order ceiling; it has `daily_setup_cap`, `auto_execute_c_grade`, `execution_enabled`, `execution_dry_run`, risk fields.
- Worker conventions exist under `src/routes/api/public/worker/*` and `cron/*` — the reconciler follows them, no new pattern.
- AUDUSD and the other Wave 1 pairs are in `data_validation` with near-zero elapsed evidence. Nothing in this plan promotes them.

## 1. Remove EIA (safe removal, provenance preserved)

- Delete `src/lib/news/providers/eia.server.ts` and its cron job branch; keep the provider-neutral interface, `economic_events` and all news tables intact.
- Remove `EIA_API_KEY` from redaction lists and any config; delete the stored secret only after confirming no other use.
- Mark any EIA provider record inactive rather than deleting history.
- Coverage stays honest and fails closed: EIA petroleum `unavailable`, OPEC `unknown`, USOIL/UKOIL news readiness `incomplete` — so both refuse new-entry authorization wherever energy news coverage is required.

## 2. FRED only

- FRED stays the sole authorized provider, server-side `FRED_API_KEY`, never in code, VITE vars, rows, logs, URLs, fixtures or docs.
- Add a documented rotation gate: because a credential was pasted in conversation, production ingestion requires the owner to rotate it through the secret manager.
- Date without authoritative time keeps `timestamp_incomplete` and cannot clear intraday suppression. Wave 0 stays comparison-only.

## 3. Lifecycle and readiness wording

- No promotions. AUDUSD and all Wave 1 stay `data_validation`: collection only, no evaluation, candidate, shadow, publication, MCP visibility, alert, delivery or broker call. No flag may bypass a stage.
- Replace the readiness sentence with the corrected wording (readiness proves only that inputs can be safely obtained; publication requires shadow, resolved outcomes, calibration, holdout, regression checks and an audited transition; alerts gate separately) in docs and in the readiness/commissioning copy where it appears.

## 4. Active-signal execution reconciler (the actual fix)

New `src/lib/delivery/reconcile-active.server.ts` plus a worker route `src/routes/api/public/worker/reconcile-active.ts`, bounded and idempotent, invoked on a schedule and after arming / account reconnect / retryable failure / execution-settings change.

For each user with `execution_enabled`:

1. Load their active, unexpired, non-cancelled/superseded signals.
2. Re-run **the same** gate stack the publish-time path uses — lifecycle, news policy, instruments, sessions, grade and C-grade opt-in, intel gate, daily setup cap and C-order ceiling, risk per trade, daily risk, exposure and correlation, account execution mode, provider symbol and conversion readiness — no parallel rule set.
3. Rank survivors with the existing deterministic feed ordering (grade, then `detected_at`, then `id` as stable tie-breaker) — reused, not reinvented.
4. Take at most `maximum_active_signal_orders`.
5. Revalidate each immediately before creating a delivery (quote freshness, `maximum_entry_exceeded`, spread/slippage, geometry, sizing, margin) and again pre-send; refuse with a durable reason rather than chasing price.
6. Insert via the existing `(user_id, signal_id, bridge_profile)` conflict target so two concurrent workers cannot duplicate.

Alerts remain non-authoritative: the reconciler reads signal state only, never alert rows; alert failure never blocks an order and alert success never authorizes one. No alerts are recreated.

## 5. Capacity setting

Migration adds `scanner_settings.maximum_active_signal_orders` (default 3, min 0, max 10+ per capacity), with GRANTs, exposed in the settings UI. It is a ceiling, never a quota — three qualifying signals means at most three orders, none means none — and it is subordinate to daily caps, concurrent-position, exposure and every risk gate.

## 6. Demo only

`live_execution_enabled` stays false. The canary runs on one authoritative demo account (broker/account evidence, not display name), Wave 0 signals only, up to ten qualifying orders with no minimum, dry-run first, kill-switch and suspension drills, broker reconciliation. Demo-only enforcement is checked independently at reconciliation, enqueue, pre-send revalidation and final destination check. Live authorization is not requested here.

## 7. Tests

New/extended coverage for: EIA absence and no `EIA_API_KEY` references; FRED secret protection and date-without-time; partial coverage; Wave 0 comparison vs Wave 1/2 fail-closed; reconciliation after late arming, reconnect, transient enqueue failure and settings change; expiry, `maximum_entry_exceeded`, stale quote; duplicate prevention under concurrent workers; ordering with fewer than, exactly and more than ten eligible signals; user limit below ten; daily-risk, exposure and correlation exhaustion; alerts independent of execution; live-account refusal; suspension immediately before submission; broker reconciliation. Then the full CI-equivalent suite.

## 8. Documentation and final report

Update news architecture, FRED integration, coverage matrix, flags, lifecycle, feed ordering, automatic execution, reconciliation, demo execution, refusal taxonomy, settings, operations, security, rollback, release notes and a dated audit. Every statement implying EIA is configured or active is corrected to: FRED = authorized (rotation pending), EIA = not integrated, OPEC = unknown, breaking news = unavailable, global calendar coverage = partial. Final report covers start/end SHA, CI result, EIA removal, FRED runtime status, per-currency coverage, the confirmed root cause and call paths, reconciler behaviour, exact ranking, idempotency proof, limit behaviour, demo canary results, confirmation no live account received an order, Wave 0 parity, test counts, docs changes, remaining evidence gates and the safest next step.
