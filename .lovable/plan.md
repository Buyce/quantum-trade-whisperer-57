# Prompt 10 + 11 — Second-pass red-team review and revised plan

## A. Plan defects discovered (reviewing my own plan against HEAD)

P1. **Duplicated business logic re-introduced by the fix.** The plan said "one pure module `eligibility.ts`" and, in the same section, "mirrored exactly by one SQL function used by the cap RPC". That is two implementations of the same rule in two languages — exactly defect D2 in a new place, with worse drift risk because SQL and TS are tested separately.

P2. **The two-table ledger + claim RPC is more machinery than the defect needs.** Eligibility is a pure function of (signal row, that user's settings, now). It therefore does not need to be stored to be correct, and the cap does not need a claim ledger to be race-free: counting *eligible graded signals of the day in deterministic order* is idempotent and gives the same answer on every retry. The plan invented `signal_eligibility` + `claim_signal_eligibility` to solve a race (D6) that disappears once the cap is derived rather than consumed.

P3. **Channel confusion inside one function.** A single `evaluateEligibility` returning one boolean invites the feed to be gated by `alert_min_grade` (or alerts by `min_grade`). The feed and the alert channel have different grade thresholds at HEAD, verified in `feed.tsx` (`min_grade`) vs `alerts.server.ts` (`alert_min_grade`).

P4. **Cap order was undefined — a real determinism hole, not a race.** "Count of today's eligible graded signals" is ambiguous while the day is still open. Without a fixed ordering rule the backend (publish-time count) and the feed (recompute over a 400-row window) can disagree about which signals were inside the cap.

P5. **MCP semantic regression hidden in a "fix".** Changing `list_signals` default scope to the user's scanner filters *and* current-only removes rows an agent could previously see, including signals the user has already journaled. An agent mid-conversation would lose the row it is being asked about.

P6. **Retention constant duplication.** `RETENTION_HOURS` lives in client code; a server-side eligibility path adopting "the identical constant" by copy is a guaranteed future divergence.

P7. **Migration/purge interaction not specified.** Ledger rows referencing `scanned_signals` collide with `purge_expired_signals`. Unspecified FK behaviour = purge starts failing (a scanner-path outage caused by an observability table).

P8. **Signal-count perception regression.** Filtering the realtime toast strictly reduces visible events; making the cap per-user increases alert volume for capped users. Both are intended, but the plan had no user-visible wording change, so the UI would silently mean something new.

P9. **Leakage risk the plan never ruled out.** If per-user delivery/eligibility ever conditions shadow enrolment, research candidates, `payoff_stats` or `regime_stats`, it injects per-user selection bias into model statistics. The plan did not state this as a hard invariant.

P10. **Unrelated MetaApi cost left in scope.** H6 (two quote calls per `calculate_position_size`) was listed as a risk but not assigned a fix, so it would ship unchanged.

Not defects (verified, and left alone): `get_performance_summary` expectancy already treats breakevens in the denominator only and matches `computeExpectancy`; RLS on `executed_trades`/`scanner_settings` is already `auth.uid()`-scoped; `regime_stats` is already model-version anchored; grading/replay/MetaApi paths are untouched by this work.

## B. Revised plan

### B1. Cap: derived, not consumed
Delete `signal_eligibility` and `claim_signal_eligibility` from the design. Definition, applied identically everywhere:

> A user's daily cap counts **graded (A+/A/B) signals eligible for that user**, ordered by `(detected_at, id)` ascending within the UTC day. The first `cap` such signals are inside the cap; the rest are `daily_cap_reached`. `cap = 0` means unlimited. C-grade never counts.

Consequences: no race (nothing is claimed), retries are naturally idempotent, no partial writes, no new PK, no rollback of stored decisions. Accepted cost: changing settings mid-day retroactively changes which of *today's* signals were eligible, so allowance can shift once. That is bounded, visible, and preferable to a stored ledger that can disagree with the settings the user is looking at.

### B2. One implementation, TypeScript only
`src/lib/delivery/eligibility.ts` (pure, no imports of Supabase):
- `evaluateEligibility({ signal, settings, channel, now, priorEligibleGradedToday })` → `{ eligible: boolean, reason }`, `channel: "feed" | "alert"`; `feed` uses `min_grade`, `alert` uses `alert_min_grade`. Fixes P3.
- Reasons: `eligible | instrument_filtered | session_filtered | below_min_grade | below_alert_grade | resolved | expired_retention | daily_cap_reached | session_unknown_allowed`.
- Retention/grade-rank constants move into this module (or `src/lib/db-types.ts`) and the feed imports them. No second copy. Fixes P6.
- No SQL mirror. The alert path calls the TS function; the feed calls the same function; MCP calls the same function. Fixes P1.
- Missing `market_context` (pipeline writes it after the signal) ⇒ session unknown ⇒ **not** session-suppressed, reason recorded. Preserves current fail-open behaviour.

### B3. Wiring (no behaviour flags on correctness paths)
- `alerts.server.ts`: replace the inline block and the global cap count with one query for today's graded signals plus `evaluateEligibility` per user. Delivery stays fail-open per channel; eligibility fails **closed** only in the sense that an unreadable settings row means "use defaults", never "alert everyone".
- `feed.tsx`: single call site for filtering, cap badge, and the realtime toast (toast now respects instrument/session/grade). Fixes D3.
- `queries.ts`: keep the 400-row window but derive cap maths from the UTC-day slice explicitly, so windowing can never truncate today (H1).

### B4. Observability ledger — deferred, append-only, optional
`signal_deliveries` only (per attempt: user, signal, channel, outcome, http status, reason), `ON DELETE CASCADE` from `scanned_signals`, owner-scoped RLS, GRANTs, purged with `purge_expired_signals`. It records what happened; it never decides anything. Ships **after** B2/B3 are green, so a logging table can never break the scanner. Fixes P2, P7.

### B5. MCP (Prompt 11), regression-safe
- Grade filter pushed into SQL **before** `limit` (D7).
- New `scope` param: `"all_published"` remains the **default** (no contract change); `"my_scanner"` is opt-in and documented. Every row always carries `status` and `resolved_outcome` so an agent can tell current from historical, and journaled signals are never hidden. Fixes P5, D8 without a silent regression.
- `update_my_settings`: `confirm_risk_change: true` required for `account_equity`, `risk_per_trade_percent`, `leverage`, `max_stop_loss_percent`, `max_position_size`.
- `calculate_position_size`: memoise the AUDUSD/GBPUSD quote per invocation and skip the fetch when the account currency makes it unnecessary. Fixes P10.
- Descriptions rewritten to state scope, cap semantics and R basis truthfully.

### B6. Hard invariants (asserted by tests)
1. Nothing in this work touches grading, replay, MetaApi fetch, or `scanned_signals` writes ⇒ **published signal count is unchanged**.
2. Per-user eligibility never conditions `shadow_executions`, `research_candidates`, `payoff_stats`, `regime_stats`, or weekly stats. Fixes P9.
3. Prompt 7/8/9 semantics frozen; existing tests are the regression baseline.

## C. New acceptance criteria
1. Exactly one eligibility implementation; a test asserts no SQL function and no second TS copy computes it.
2. Gold-only / min A / London / cap 2: two EURUSD B rows consume **zero** cap; the XAUUSD A+ is eligible. Third eligible Gold A ⇒ `daily_cap_reached`.
3. Cap determinism: given the same day's rows in any insertion order, the in-cap set is identical (ordering by `detected_at, id`).
4. Feed uses `min_grade`, alerts use `alert_min_grade` — asserted separately.
5. Toast fires only for rows the shared function marks eligible for `channel: "feed"`.
6. `list_signals(min_grade="A", limit=2)` returns 2 A rows against 127 B / 3 A; default scope output is a superset of today's HEAD output (no row disappears).
7. Risk-changing MCP fields rejected without `confirm_risk_change`.
8. `bun run verify` green; signal count, grading output and all Prompt-7/8/9 tests unchanged.

## D. Remaining risks
- Mid-day settings edits shift today's cap allowance (accepted, documented in the UI copy).
- Feed cap maths still derives from a client-visible slice; correct for today, but a very high-volume day would need server-side pagination.
- Delivery ledger, once added, grows with users × signals; bounded only by the purge job.
- Per-user cap raises alert volume for capped users. Currently **0 users have cap > 0**, so production impact today is nil.

## E. Confidence
**High** on the cap redefinition and the single-module design: the defect is reproducible from `alerts.server.ts` at HEAD, and removing the ledger removes the race, the partial-write path and the irreversible migration rather than managing them. **Medium** on the MCP scope change being invisible to existing agents — mitigated by keeping the old default. **Low-to-medium** on delivery telemetry ever being statistically meaningful at 5 users; it is observability only.

## F. What still cannot be guaranteed
Broker-authoritative contract specs for position sizing (static specs remain, labelled as such); that a push/email provider actually delivered what we recorded as attempted; that a user's own mid-day settings edits will feel intuitive; any inference from delivery data at current sample sizes.
