# Second-pass red team: Replay-versioning plan (revised, still no implementation)

Reviewed as if written by someone else, against HEAD re-read this turn plus fresh read-only queries. The identity model and the TIF/actual-risk corrections survive. Three parts of my own plan do not: the `regime_stats` replay argument, the uniqueness design, and M1 adjudication in this release.

## A. Plan defects discovered

**A1 — `regime_stats` cannot take a replay dimension as I proposed (blocking).** PK is `(model_version, tier, regime_key)` and `recompute_regime_stats` starts `DELETE ... WHERE model_version = _model_version AND tier >= 0`. Adding a `_replay_version` argument without putting `replay_version` in the PK **and** the DELETE predicate means a replay-2 recompute silently overwrites production replay-1 priors — the exact defect the previous red team logged as A1, repeated. Since Replay V2 is research-only anyway, the correct fix is not to touch `regime_stats` at all in this release.

**A2 — consumers double-count the moment the backfill runs (blocking).** `get_admin_intelligence()` reads `shadow_executions` with **no** `model_version` filter in its fill-diagnostic, grade-calibration, discipline and taken-performance CTEs (verified in the function body). `weekly.server.ts` filters `model_version` but nothing else. After the backfill every plan has two rows, so admin tiles, the weekly report, `signal-audit`, `export.ts` and the `get_shadow_comparison` MCP tool all roughly double. Filters must land **before or with** the backfill, never after, and the latent V2/V3 contamination in `get_admin_intelligence()` must be closed in the same migration.

**A3 — my uniqueness design breaks enrolment idempotency on promotion (blocking).** `processNextShadowJob` relies on unique-violation `23505` on `signal_id` as its "already enrolled" path. I proposed a partial unique index limited to `replay_version = 1`; once `active_replay_version` becomes 2, new enrolments are unprotected and a re-kicked queue job inserts a duplicate. The partial index must be `(signal_id, replay_version) WHERE signal_id IS NOT NULL`.

**A4 — M1 adjudication is not "the same endpoint, no new surface" (high).** `fetchCandles` builds `.../candles?limit=N` only — no `startTime`. Adjudicating an M15 bar from 2026-08-11 needs historical-window paging that does not exist in the client, plus ~14,400 M1 bars per instrument for the current 10-day span. That is new integration code, new failure modes and a real MetaApi cost increase inside an hourly cron already carrying three 8s fetches. Ship fail-closed M15 semantics first; adjudication becomes its own prompt.

**A5 — a replay-semantics change was hiding in the plan (high).** Enrolment writes `replay_cursor = detected_at`, so in production the `replayCursor == null` "replay the forming bar" branch never executes and the detection bar is skipped. Any v2 rewrite that starts consuming that bar would **increase** fill counts — a trading-model change disguised as a bug fix, moving in the opposite direction to the TIF fix and confounding the paired comparison. V2 must keep the strictly-after-detection window byte-for-byte and log the dead branch as a separate documented question.

**A6 — wrong statistical test for a paired design (medium).** The weekly report's two-proportion z-test assumes independent groups. Replay V1 vs Replay V2 is the *same plans* scored twice: paired binary outcomes need McNemar (discordant pairs), and paired R needs a paired test, not two independent means. Reporting a z-test on paired data would overstate significance.

**A7 — `plan_id = id` backfill is right, but for a reason I had not verified (medium).** 149 of 326 rows already carry `signal_id IS NULL` (purge sets it null), all `model_version = 1`. So `signal_id` is already useless as an identity for nearly half of *production* rows, not just for V2/V3 — which strengthens plan identity and means the backfill must not filter on `signal_id IS NOT NULL` anywhere.

**A8 — milestone versioning was over-engineered (medium).** `fill_gate_notified_at` is already set (2026-08-19); `win_gate_notified_at` is NULL. Since replay 2 never feeds `regime_stats` in this release, `notifyLearningMilestones` cannot fire on replay-2 data, so no version-specific milestone table is needed yet. Adding one now creates an unused table and a second code path. Defer it to the promotion prompt, and keep the existing latch untouched.

**A9 — smaller findings.** Two replay functions invite drift: ladder/excursion maths must be shared pure helpers with V1 frozen by its characterisation tests. Rollback after backfill cannot restore the old `signal_id` unique constraint while paired rows exist — delete `replay_version <> 1` first. `shadow_executions` stays service-role-only, so no RLS/SSRF/auth surface changes; no alert, push, webhook or `scanned_signals` write path is touched, so published signal count cannot move.

## B. Decision-by-decision defence

**B1. Plan identity = `plan_id`, backfilled `plan_id = id`.**
Alternatives: (i) `UNIQUE (signal_id, replay_version)`; (ii) a natural key such as `(model_version, observation_key, structure_key)`. Rejected (i): 149 production rows have NULL `signal_id`, and NULLs never conflict, so it enforces nothing for half the data. Rejected (ii): only 27 distinct `observation_key` values exist and historical rows are NULL, so a natural key cannot address the backlog. Evidence: the NULL counts above; `id` is immutable and already unique. Changes my mind: if plans ever need to exist before a shadow row (a separate `shadow_trade_plans` table), identity moves there and `shadow_executions` becomes its child.

**B2. Replay V2 is research-only; `regime_stats` untouched.**
Alternatives: (i) add `replay_version` to the `regime_stats` PK + DELETE + all reads now; (ii) point production at replay 2 immediately. Rejected (i): a second PK rebuild and a fourth predicate on every learning read, for a cohort nobody is allowed to trust yet — build it in the promotion prompt when it is actually needed. Rejected (ii) outright: A1/A2 make it unsafe, and the user's own instruction is explicit. Evidence: the PK and DELETE predicate quoted in A1. Changes my mind: nothing, before the promotion gates pass.

**B3. Fail-closed M15 TIF now, adjudication later.**
Alternatives: (i) M1 adjudication in this release; (ii) keep optimistic fills and merely flag them. Rejected (i) on A4 (new client capability, ~14,400 bars/instrument, cost and lifecycle risk). Rejected (ii): the flag would leave 13 known post-expiry fills, 8 of them wins, inside the labels. Evidence: `fetchCandles` has no `startTime`; the 8s fetch ceiling; measured 13/88 late fills. Changes my mind: once a windowed candle fetch exists and is separately tested, `adjudication` (already in the schema as `m15_unambiguous | m15_conservative_fallback | m1_resolved | m1_still_ambiguous | m1_unavailable`) accepts the new states with no migration.

**B4. Separate analytics from realized R; one executable policy (`single_exit_first_target`).**
Alternatives: (i) keep best-target-touched and rename it; (ii) invent a partial-exit ladder. Rejected (i): unexecutable — a fully closed position cannot be improved by a later touch. Rejected (ii): allocation fractions do not exist in the product and would be fabricated. Evidence: current ladder loop takes the last (highest-R) hit in the bar. Changes my mind: a real, versioned allocation policy in settings — then it is a new `execution_policy` value, replayed in parallel.

## C. Failure scenarios the architecture must survive

1. **Backfill lands before consumer filters.** Admin tiles and the weekly email double overnight and the operator acts on inflated numbers. Mitigation: filters ship in the same migration/deploy as the backfill flag; `replay_v2_backfill_enabled` defaults false; a blocking test asserts every `shadow_executions` read path (SQL function + TS) constrains `replay_version`.
2. **Backfill floods the hourly resolver.** 326 replay-2 rows plus live replay-1 rows in one 200-row budget ordered by `detected_at ASC` would starve production. Mitigation: explicit `(model_version, replay_version)` budgets, `(1,1)` claimed first, and a separate bounded backfill worker route with its own flag. Assertion: with 300 open replay-2 rows and 5 open replay-1 rows, all 5 replay-1 rows advance in the first pass.
3. **Concurrent/re-kicked enrolment after promotion.** Mitigation: partial unique index on `(signal_id, replay_version) WHERE signal_id IS NOT NULL` keeps the `23505` idempotency path alive at any active version (A3).
4. **Partial write mid-batch.** The resolver writes row-by-row; a throw mid-batch leaves earlier rows advanced and later cursors untouched — replay is idempotent on identical candles, so the next pass resumes. Assertion: injected failure on row *k* leaves rows > *k* byte-identical.
5. **Rollback with paired rows present.** Order: set `active_replay_version = 1` → delete `replay_version <> 1` → drop constraints/columns. Documented as the only safe direction.

## D. Revised plan

**D1 — Migration (additive, one file).** `plan_id uuid` (backfill `= id`, then NOT NULL); `replay_version smallint NOT NULL DEFAULT 1`; `execution_policy text NOT NULL DEFAULT 'legacy_best_target_touched'`; fill/event-time columns `fill_bar_time`, `filled_at_resolution`, `fill_gap_through`, `fill_ambiguous_tif`; risk/R columns `risk_price_actual`, `gross_r`, `cost_scenario`, `net_r`; barrier analytics `first_target_touched`, `max_target_touched`, `tp1_before_stop`, `stop_before_tp1`; ambiguity `adjudication`, `ambiguous_bars`. Drop `shadow_executions_signal_id_key`; add `UNIQUE (plan_id, replay_version, execution_policy)` and partial unique `(signal_id, replay_version) WHERE signal_id IS NOT NULL`; add `(model_version, replay_version, status)` partial index. `shadow_engine_state`: `active_replay_version smallint NOT NULL DEFAULT 1`, `replay_v2_backfill_enabled boolean NOT NULL DEFAULT false`. Rewrite `get_admin_intelligence()` to filter `model_version = 1 AND replay_version = active_replay_version` everywhere it reads `shadow_executions` (closes A2's latent V2/V3 hole too). **No change to `regime_stats`, `recompute_regime_stats`, `claim_learning_milestone`, or the milestone latches.**

**D2 — Legacy rows.** `replay_version = 1`, policy `legacy_best_target_touched`, `fill_bar_time = filled_at`, `filled_at_resolution = 'm15'`. `risk_price_actual`, `gross_r`, `net_r`, analytics and adjudication stay NULL — never measured, never inferred. `realized_r`, `filled_at`, `ml_target_label`, `resolved_outcome`, `replay_cursor` are never written again.

**D3 — `replaySetupV2`.** Frozen `replaySetupV1` retained; shared pure helpers for ladder/excursions. Changes vs V1, and only these: TIF fail-closed on bar intervals (fill only when the bar interval ends at or before `D`; a bar spanning `D` sets `fill_ambiguous_tif` and does **not** fill, `adjudication = 'm15_conservative_fallback'`); R normalised on `risk_price_actual = |fill − stop|`; `single_exit_first_target`; barrier analytics recorded independently; favorable gap fills only (worse-than-limit is unrepresentable for a limit order — the adverse fixture is rejected); candle window semantics **unchanged** (strictly after `detected_at`, per A5).

**D4 — Resolver + backfill.** Per-`(model_version, replay_version)` budgets, production-first. Separate flag-gated bounded backfill worker enrolling every existing plan (V1 published, V1 signal-less, and any future V2/V3) as a replay-2 row via `plan_id`. No `regime_stats` participation.

**D5 — Reporting.** Admin-only paired panel over shared `plan_id`: fill/win/R deltas, McNemar on paired labels (A6), ambiguity and fail-closed counts, coverage. Gross R labelled gross; `cost_scenario = 'none'`, `net_r = NULL`, "net unavailable" everywhere. MCP tools stamp `replay_version`, `execution_policy`, `cost_scenario`. Legacy `realized_r` relabelled as barrier-touch analytics, not realized P&L.

**D6 — Promotion is a separate prompt.** It owns: `replay_version` in the `regime_stats` PK/DELETE/reads, version-specific milestone state, `active_replay_version` flip, and the gate report (coverage, zero duplicate identities, zero post-TIF fills, actual-risk checks, ambiguity rates, fill/win and prior deltas, 150/200 gate impact, reviewed paired report). No automatic promotion.

## E. New acceptance criteria

1. Every legacy row: `plan_id = id`, `replay_version = 1`, and a checksum over `(realized_r, filled_at, ml_target_label, resolved_outcome, replay_cursor)` identical before and after the whole release.
2. Zero NULL `plan_id`; zero duplicate `(plan_id, replay_version, execution_policy)`.
3. With replay-2 rows present, admin tiles, weekly report, `signal-audit`, `export` and both MCP tools return the **same** numbers as before the backfill.
4. `regime_stats`, priors, EV sorting, Intelligence copy, milestone latches and published-signal count unchanged across the window.
5. No replay-2 row has a fill whose bar interval ends after `detected_at + 30m`; every replay-2 loss is exactly −1R on `risk_price_actual`; no replay-2 fill is worse than the limit.
6. Simulated 300 open replay-2 rows do not delay 5 open replay-1 rows.
7. Rollback rehearsed in the D-order with no error.
8. Zero new MetaApi calls attributable to this release (no M1 fetching).

## F. Remaining risks · G. Confidence · H. Cannot guarantee

Risks: two replay code paths can drift (mitigated by shared helpers + frozen V1 tests); the 24h vertical barrier has still fired zero times in production and is fixture-only; ~10 days / one regime of data means the paired comparison may be directionally clear but not decisive; the skipped-detection-bar question (A5) stays open and keeps fill rates conservative; `is_admin()` remains an email literal.

Confidence: **high** that this release is safe and reversible — additive DDL, no production read repointing, no `regime_stats` change, no live-path or alert change, no extra broker calls. **Medium** that corrected fill/win numbers will be judged acceptable at promotion. **Low** that any single instrument × session × volatility cell is meaningful at current sample sizes.

Cannot guarantee: that corrected labels stay above the 150/200 gates; that fail-closed TIF is not slightly pessimistic without M1 (some genuinely-in-window fills will be dropped, and that residual is unmeasurable until adjudication exists); that net-of-cost R ever becomes available without a documented broker cost schedule; that MetaApi retains M1 depth for the oldest samples when adjudication is built; that user-reported performance means anything until real verified prices exist.

**Recommendation: approve D1–D5 as the implementable release, with D6 (promotion) as a separate approval. Discard the `_replay_version` argument to `recompute_regime_stats`, the replay-1-only partial index, the version-specific milestone table and in-release M1 adjudication.**
