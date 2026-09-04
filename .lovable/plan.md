# MT4/MT5 automatic trading through MetaApi — audit and completion plan

## 0. Audit result (verified against the live database and source, this session)

Most of the requested infrastructure already exists and works. The brief's real gaps are narrower than it assumes.

**Already built and correct**
- MetaApi access layer: single request path, 8s timeout, trusted host resolution per region, no credential logging (`src/lib/metaapi/*`). Broker-authoritative demo/real classification from account information — never name or server label (`classify.ts`, `accounts.server.ts`).
- Onboarding: connect → secure MetaApi configuration link → deploy → connect → reconcile/verify → observe → arm (`accounts/provision.server.ts`, `arm.server.ts`, `/accounts`). Only the MetaApi account id and safe metadata are stored; `trade_allowed`, `investor_mode`, `margin_mode`, equity and specs come from the broker.
- Execution authority is already signal-driven, not alert-driven, and documented as such (`reconcile-active.server.ts` header, `docs/EXECUTION.md`).
- Missed-signal reconciler already exists and runs on cron (`worker/reconcile-active`, migration `20260825195838`), re-running the same authoritative gate stack, bounded to 25 signals, DB-idempotent on `(user_id, signal_id, bridge_profile)`.
- Pre-send revalidation already checks signal state/TIF, maximum acceptable entry, quote freshness, spread (twice — published and broker-grid geometry), slippage ceiling, symbol spec, stop level, volume rounding, margin, exposure, account mode and global controls.
- Broker states already separated: `pending / claimed / sent / acknowledged / rejected / unknown / failed / expired`, with `unknown` never auto-resubmitted, plus broker evidence association by account id, clientId, magic, order id, position id and deal id (`evidence/*`).
- Live boundaries already default OFF: `live_execution_enabled = false`, `live_auto_enabled = false`, `allowed_live_hosts = []`, `demo_auto_enabled = true`, `force_dry_run = false`.
- Root cause of accepted-but-unfilled orders was already established from broker evidence: pending limit orders were placed on setups whose price had moved away and left resting until timeout — not a submission bug. Fixes shipped: configurable `auto_order_window_minutes`, optional market entry inside the published maximum entry, unfilled-order timeout, and truthful "resting at broker — not filled" labelling.

**Real gaps to close**
1. **News protection is not wired.** `evaluateNewsPolicy()` exists and is tested, but nothing in the enqueue or revalidation path calls it. High-impact news does not currently block an order.
2. **No user-facing spread or slippage ceiling.** Both gates run on engine constants; there is no per-user limit as the brief requires.
3. **Exposure limit is count-based only** (`maximum_concurrent_signal_orders`, `max_account_open_positions`). There is no total-exposure-percent ceiling.
4. **Safe defaults differ from the brief** (grade threshold, 0.5% risk, 1% total exposure, 2 orders/day, 1 concurrent, market entry off, news blocked, stop widening prohibited) — defaults must be applied to new users without changing anyone's existing settings.
5. **Reconciler is time-triggered only.** It does not run on the events the brief names: automatic trading switched on, account reconnect, sync recovery, enqueue failure, relevant settings change.
6. **`live_confirm` is inert** — nothing enqueues it and there is no confirmation surface. Build the infrastructure, keep it disabled.
7. **No customer-visible emergency stop / disarm-all**, and admin diagnostics lack a single account-health + submission + fill + deployed-version view.

## 1. Scope of changes

### A. News, spread, slippage, exposure (demo-safe, applies to demo auto too)
- Wire `evaluateNewsPolicy` into the enqueue gate and again into pre-send revalidation, with refusal reasons `news_blocked_high_impact` / `news_data_unavailable`. When coverage is unavailable the verdict is "unknown" and the order is refused, not allowed.
- New user settings: `max_spread_points`, `max_slippage_points`, `max_total_exposure_percent`, `news_protection_enabled` (default on). Enforced in enqueue where cheap and always again before submission.
- Total-exposure-percent computed from open/resting P-Trades deliveries and broker equity; labelled advisory where broker state is not directly readable, per the existing rule.

### B. Safe defaults and limits
- Column defaults + new-user profile creation set: A-grade minimum, 0.5% risk, 1% total exposure, 2 orders/day, 1 concurrent, market entry off, news blocked, no stop widening. Existing rows are untouched.
- Owner may deliberately raise the ceiling; the evaluation set is capped at the top ten eligible active signals by the existing deterministic ranking. No minimum number of trades is ever forced.

### C. Event-driven reconciliation
- Trigger a bounded reconcile pass (same authoritative path, same decision trail) after: automatic trading enabled, relevant settings saved, account mode armed, account reconcile/reconnect success, and after an enqueue attempt fails. Cron stays as the safety net. Only signals still active, entryable, and without an existing active or successful delivery are reconsidered.

### D. Live Confirm / Live Auto infrastructure (built, disabled)
- New non-claimable delivery state `awaiting_confirmation` with automatic expiry when the setup's window or TIF passes.
- Enqueue supports `live_confirm` on a broker-confirmed real account only while `live_execution_enabled` is on — which stays false.
- Owner-authenticated `confirmLiveDelivery` / `declineLiveDelivery`; confirmation is authorisation only and never bypasses pre-send revalidation.
- New controls, all default false: `customer_live_confirm_enabled`, `customer_live_auto_enabled`, plus per-account live limits and a `live_kill_switch_reason`.
- Split the allow-list rule: the non-empty host requirement applies to the external bridge destination only, since direct MetaApi execution has no host. Bridge deliveries keep failing closed.
- No live-money order is authorized by this work.

### E. UI and diagnostics
- `/accounts`: connection + synchronization state, broker-derived Demo/Real, armed mode, disarm, and an **emergency stop** that disarms every account and cancels every claimable delivery in one action.
- `/history`: orders pending / open / closed with truthful labels, plus a **Live order queue** panel (confirm/decline, countdown, lot size, cash at risk, margin labelled estimate) that stays empty while live is off.
- Settings: the new risk/news/spread/slippage/exposure controls with plain-language refusal explanations.
- Admin: one account-health and execution-diagnostics panel — deployment/connection state, deliveries by state, submissions, fills, reconciliation health, error taxonomy and deployed version. No credentials, no stack traces.

### F. Tests and verification
Onboarding lifecycle, demo/real classification, sizing and volume rounding, broker symbol resolution, stale quote/equity/spec refusal, duplicate prevention, event-driven reconciliation, market vs pending orders, acknowledged-vs-filled, MetaApi 504/timeout → `unknown` with no resubmit, history pagination, reconnection, cancellation, closure, RLS, news blocking, spread/slippage/exposure ceilings, and live-account blocking while the gates are off. Then lint, typecheck, full suite, security scan and production build.

## 2. What I cannot do from here

Git branching, commits, pull requests, GitHub Actions runs and SHAs are outside my tooling — I do not run stateful git commands. I will deliver the change set in this project with migrations applied on your approval, and report files and migrations changed, root causes, test results and remaining blockers. You (or CI) handle branch/PR/SHA reporting.

The demo canary is real work and is done last: one minimum-volume order on your broker-confirmed demo account, tracked from submission through fill or correct pending state, then closed or cancelled and reconciled from broker evidence. I will not call automatic trading functional before that evidence exists.

## 3. Sequence

1. Record this brief in `roadmap.md`.
2. Migrations: new settings columns + defaults, `awaiting_confirmation` state and confirmation identity, live control columns, kill switch.
3. Wire news, spread, slippage, exposure into enqueue and revalidation.
4. Event-driven reconciliation triggers.
5. Live Confirm infrastructure (disabled) + allow-list split.
6. UI: emergency stop, live queue, settings, admin diagnostics.
7. Tests, lint, typecheck, build.
8. Demo canary + reconciliation evidence + duplicate-prevention and kill-switch checks, and confirmation that no live account received an order.

## 4. Unchanged by this plan

Your demo auto-trader keeps running. Scanner publication, grading, research/shadow statistics and the zero-fabricated-data rule are untouched: no seeded signals, deliveries or fills. Live execution stays off until a separate approval.
