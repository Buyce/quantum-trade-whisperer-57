# Prompt 10 + Prompt 11 — Deep audit and implementation plan

## 1. Goal
Prompt 10: one canonical answer to "is this signal eligible for this user on this channel, and if not, why" — shared by feed, realtime toast, push, email, webhook and MCP — plus an auditable delivery record and an unambiguous daily-cap definition.
Prompt 11: make every MCP tool's behaviour and description mathematically and operationally true, with correct ordering/scoping semantics and contract tests.

## 2. Current implementation (verified at HEAD)
- `src/lib/scanner/alerts.server.ts` re-implements eligibility inline (instrument, session, `alert_min_grade`, cap) and fans out email → push → webhooks. Failures are swallowed per channel (correct: fail open).
- Cap counter in `alerts.server.ts` is a **global** query: `scanned_signals` where `detected_at >= UTC midnight` and grade in (A+,A,B), excluding the current id. It is not filtered by the user's instruments/sessions/grade.
- `src/routes/_authenticated/feed.tsx` re-implements the same rules twice more: `cappedOutIds` + `todayCount` (again global, UTC day), and the realtime handler. The realtime `toast.info` fires for **every** INSERT with no instrument/session/grade filter; only the OS `Notification` is gated.
- `src/lib/queries.ts` fetches 400 newest signals unfiltered; retention/cap/filters are client-side only.
- No `signal_deliveries` table exists. Only `webhook_dispatch_log` (2 rows) records physical delivery; email/push/feed leave no trace.
- RLS: `scanned_signals`, `market_context`, `regime_stats` are `SELECT true` to `authenticated`; `executed_trades`/`scanner_settings` are `auth.uid() = user_id`. No weakening needed.
- MCP `list_signals` applies `limit` in SQL, then filters `min_grade` in JS; no `status`/retention filter; no user-settings scope.
- MCP `get_performance_summary` uses `selectR` + the same expectancy formula as `computeExpectancy` (breakevens counted in denominator, not as losses) — already consistent.
- MCP `get_intelligence` already labels EV as deprecated probability with `expected_r: null`; `calculate_position_size` calls `fetchQuote` for AUDUSD+GBPUSD on every invocation (extra MetaApi calls) and uses static contract specs from `src/lib/risk.ts`.
- Data facts: 160 signals (127 B, 30 C, 3 A, 0 A+), 79 active, 25 trades, 5 users, **0 users with a cap > 0**, 1 push subscription. So the cap defect is currently latent, not actively harming production.

## 3. Confirmed defects
D1. Cap consumption is global, not per-user-eligible (spec violation; the Gold-only/London/cap-2 case would suppress a Gold A+ after two irrelevant EURUSD B setups).
D2. Four independent eligibility implementations (alerts, feed filter, feed cap, realtime toast) that can and already do diverge.
D3. Realtime toast ignores the user's own filters.
D4. Cap semantics undefined across channels; "15 setups/day" language is stale.
D5. No eligibility/delivery ledger — suppressions are unexplainable and undebuggable.
D6. Cap boundary has no atomicity: two concurrent publishes can each read `gradedToday = cap-1`.
D7. `list_signals` filters grade after `limit` (a `min_grade=A, limit=2` request can return zero rows while A rows exist).
D8. `list_signals` returns resolved/expired setups as if current.

## 4. Hidden risks found
H1. Feed reads only the newest 400 rows; any cap/eligibility maths derived client-side is silently windowed.
H2. Retention (`RETENTION_HOURS`) is a pure client rule; a server-side eligibility function must adopt the identical constants or feed and MCP will disagree.
H3. `market_context` is inserted **after** `scanned_signals` (pipeline.server.ts:500 vs 564) and session is read from context — an eligibility check must read the session the pipeline already computed, not re-derive it, and must handle a missing context row as *unknown → not session-suppressed but recorded*.
H4. Cap must never be consumed by a signal the user never became eligible for, and must not be consumed twice by worker retries (idempotency key = user+signal+channel).
H5. Making the cap per-user *increases* alert volume for capped users — an intentional behaviour change requiring baseline capture, though currently zero users are capped.
H6. `calculate_position_size` adds 2 MetaApi quote calls per agent invocation with no cache — a cost/rate-limit path outside the scanner budget.

## 5. Alternatives considered
**Cap semantics** — (a) eligible-for-user, (b) shown-in-feed, (c) alerts actually delivered, (d) selected-for-account.
Recommend **(a) eligible-for-user**, evaluated per UTC day: it is channel-independent, deterministic, computable server-side without waiting on delivery success, and immune to a dead push endpoint silently restoring allowance. (c) makes the cap depend on third-party uptime; (b) is unobservable server-side.

**Ledger shape** — (i) single `signal_deliveries` row per user+signal+channel mixing eligibility and delivery; (ii) split `signal_eligibility` (one row per user+signal, the cap ledger and the decision) + `signal_deliveries` (one row per attempt/channel).
Recommend **(ii)**. Eligibility is a single per-user-per-signal decision; delivery is many attempts with retries and HTTP status. Merging them makes the cap ledger's unique key channel-scoped, which breaks atomic cap accounting and double-counts a user reached by both email and push. Rejecting (i) despite it being fewer tables.

**Cap atomicity** — (i) count-then-insert in app code; (ii) `INSERT ... ON CONFLICT DO NOTHING` into `signal_eligibility` inside a security-definer RPC that counts and decides in one statement.
Recommend **(ii)**: the unique key `(user_id, signal_id)` makes retries no-ops and the count+insert is one transaction, closing D6.

**Timezone** — UTC day (recommended) vs user-local day. UTC matches `detected_at`, the existing alert query, regime buckets and Prompt-8 cluster bootstrap (whole UTC days). A local-day cap would fork the statistical unit of analysis; rejected.

**`list_signals` scope** — recommend `scope` defaulting to `"my_scanner"` (user's instruments/sessions/min_grade, active + within retention) with explicit `"all_published"` research mode, plus grade filtering pushed into SQL before `limit`. This is an MCP behaviour change, so both modes ship together and the description states the default.

## 6. Recommended architecture
One pure module `src/lib/delivery/eligibility.ts` exporting `evaluateEligibility(signal, settings, now)` → `{ eligible, reason }` with reasons `instrument_filtered | session_filtered | below_min_grade | below_alert_grade | expired_retention | resolved | daily_cap_reached | eligible`. Consumed by: alerts fan-out (server), feed filter + realtime toast (client), MCP `list_signals`, and mirrored **exactly** by one SQL function used by the cap RPC. Cap accounting lives only in the RPC.

## 7–15. Schema, backend, frontend, MCP, history, security, performance
- **Schema (new only, no column changes to closed tables):** `signal_eligibility(user_id, signal_id, eligible bool, reason text, cap_consumed bool, evaluated_at)` PK `(user_id, signal_id)`; `signal_deliveries(id, user_id, signal_id, channel, status, detail, attempted_at, delivered_at)` unique `(user_id, signal_id, channel)`. Both: GRANT SELECT to `authenticated` with `auth.uid() = user_id` RLS, GRANT ALL to `service_role`, no anon. Security-definer RPC `claim_signal_eligibility(_signal_id, _user_id, _eligible, _reason)` performing count+insert atomically.
- **Backend:** `alerts.server.ts` replaces its inline rules with `evaluateEligibility` + the RPC; each channel logs a `signal_deliveries` row. Fan-out stays fail-open and never blocks a scan. No scanner/grading/entry/stop/target change; no new MetaApi calls.
- **Frontend:** feed filter, `cappedOutIds` and the realtime toast all call the shared module; the toast suppresses non-eligible instruments/sessions/grades. Settings copy states the cap definition ("graded setups eligible for you per UTC day; 0 = unlimited"). A suppression reason is shown in the feed's filter popover.
- **MCP:** `list_signals` gains `scope` (`my_scanner` default) + `include_resolved` (default false); grade → SQL `in()` before `limit`. `update_my_settings` splits low-risk preferences from financially meaningful risk fields, which require `confirm_risk_change: true` and echo old→new values. Descriptions rewritten to state exact semantics; `get_intelligence` keeps `expected_r: null`. Contract tests assert every description phrase against behaviour. Compatibility: no field removed; new params default to today's meaning where safe and the change in `list_signals` default is documented in the tool description and server `instructions`.
- **History/versioning:** ledger rows are only written going forward; no backfill, no historical rewrite. Scanner model version untouched (eligibility is delivery, not model), so no shadow model is required — but the pre-change global-cap behaviour is captured as the baseline below.
- **Security:** RLS owner-scoped on both new tables; cross-user MCP access tests; no admin/scanner table exposure to agents.
- **Performance:** one RPC call per (user, published signal) — 5 users × ~10 signals/day. Ledger growth bounded by a purge alongside `purge_expired_signals`.

## 16. Implementation sequence
1. Pure `eligibility.ts` + unit/property tests (no wiring).
2. Migration: two tables, grants, RLS, RPC, purge extension.
3. Wire `alerts.server.ts` behind flag `delivery_ledger_enabled` (default TRUE for logging, cap enforcement flag separate).
4. Wire feed + realtime toast to the shared module.
5. Baseline capture, then flip cap enforcement to per-user.
6. Prompt 11: `list_signals` scoping/ordering, settings risk confirmation, description rewrite, contract tests.

## 17–18. Test matrix (concrete)
- Gold-only / min A / London / cap 2: EURUSD B, GBPAUD B, then XAUUSD A+ London → first two `instrument_filtered`, cap consumed 0, Gold A+ **eligible**. Same user after two eligible Gold A setups → third is `daily_cap_reached`.
- Cap boundary concurrency: two parallel RPC calls at cap-1 → exactly one `cap_consumed = true`.
- Retention: A+ at 47h59m eligible, 48h01m `expired_retention`.
- `list_signals(min_grade=A, limit=2)` against 127 B + 3 A rows → returns 2 A rows (today's data would return 0 pre-fix).
- Expectancy fixture: wins +2R,+1R; loss −1R; breakeven 0R → win rate 50%, avgWin 1.5, avgLoss 1.0, expectancy 0.25R; identical in web and MCP.
- Failure injection: RPC timeout, duplicate worker retry, push 410, webhook hang, missing `market_context`, settings row absent → all fail closed on eligibility, fail open on delivery.
- DB/RLS tests: user B cannot read or write user A's eligibility/deliveries/journal/settings.

## 19. Baseline (before flipping enforcement)
Capture from live data: per-day signal count, grade/instrument/session/direction distribution, alerts that *would* be sent under global vs per-user cap, webhook dispatch counts, MCP `list_signals` outputs, risk-calculator outputs. Facts available today: 160 signals, 127 B / 30 C / 3 A / 0 A+, 79 active, 25 trades, 5 users, **0 capped users**, 1 push subscription. No A+ rows exist yet, so an A+ regression can only be tested with fixtures, not production data.

## 20–21. Deployment and rollback
Ledger logging ships first (observation only). Cap enforcement is a separate flag in `shadow_engine_state`; flipping it off restores the current global behaviour without dropping ledger rows. `list_signals` scope default is revertible by one constant. Migration rollback = drop the two new tables + RPC; nothing existing is altered, so no destructive rollback path.

## 22. Acceptance criteria
Single eligibility implementation; cap consumed only by user-eligible graded signals; UTC-day semantics identical in backend/feed/realtime/MCP; toast never fires for filtered instruments/sessions; ledger explains every suppression; concurrent cap boundary provably safe; `list_signals` grade-before-limit and current-only by default; all descriptions true; full `bun run verify` green with new tests.

## 23–24. Uncertainties and non-guarantees
Cannot guarantee: MetaApi/broker-authoritative contract specs for position sizing (deferred — static specs remain, explicitly labelled); statistical validity of any per-user delivery metric at n=5 users; that a third-party push/email provider delivered a message we recorded as attempted. Prompt-7/8/9 semantics are treated as frozen regression baselines and are not reopened.

## 25. Recommendation
Proceed — with the split two-table ledger (not the single proposed `signal_deliveries` schema), eligible-for-user cap semantics, UTC day, and atomic RPC cap accounting. Prompt 11's `list_signals` default change is the only MCP contract change and ships with both scopes.
