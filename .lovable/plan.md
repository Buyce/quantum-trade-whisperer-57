# Replay Identity and Execution-Semantics Correction (Replay Engine v2, research-only)

Revision of the previous plan. Retained: replay versioning, TIF correction, actual-risk normalisation, full preservation of legacy rows, gross/net separation. Corrected: replay identity, execution-policy honesty, ambiguity states, event-time semantics, promotion gating, runtime control, milestone latches, gap semantics, cohort coverage and scheduling.

## 1. Identity model

A **trade plan** is one immutable geometry emitted by a model evaluation (V1, V2 or V3). A **replay run** is one engine's interpretation of that plan against candles. Pairing is on the plan, never on `signal_id` — V2/V3 research plans have `signal_id = NULL` by design.

```text
trade plan (plan_id, immutable)          model_version 1 | 2 | 3
  ↓
replay run (plan_id, replay_version, execution_policy)
  ↓
fill state       unfilled → filled | never_filled            (+ fill_bar_time, filled_at, event_time_resolution)
  ↓
ambiguity adjudication   m15_unambiguous | m1_resolved | m1_still_ambiguous | m1_unavailable → conservative_fallback
  ↓
barrier analytics        first_target_touched, max_target_touched, tp1_before_stop, stop_before_tp1, MFE/MAE R, bars
  ↓
execution-policy result  policy-defined single exit
  ↓
gross_r  (before modelled costs)
  ↓
optional cost scenario   (named, documented)
  ↓
net_r    (NULL unless a scenario applies)
```

### Field ownership
- **Immutable plan** (identical across replay versions, never rewritten): `plan_id`, `model_version`, `signal_id` (nullable, V1 only), `observation_key`, `instrument`, `direction`, `grade`, `quality_grade`, `strategy_family`, `entry_source`, `stop_anchor`, `detected_at`, `entry_price`, `stop_loss`, `tp1/tp2/tp3`, `tp1_r/tp2_r/tp3_r`, `max_r`, `risk_price` (planned), `atr`, `confidence_score`, `trading_session`, `volatility_index`.
- **Per replay run** (one row per `(plan_id, replay_version, execution_policy)`): `replay_version`, `execution_policy`, `status`, `fill_bar_time`, `filled_at`, `event_time_resolution`, `fill_price`, `risk_price_actual`, `execution_slippage_pips`, `fill_gap_through`, `adjudication`, `ambiguous_bars`, `fill_ambiguous_tif`, `first_target_touched`, `max_target_touched`, `tp1_before_stop`, `stop_before_tp1`, `max_favorable_excursion_r`, `max_adverse_excursion_r`, `bars_replayed`, `bars_to_outcome`, `replay_cursor`, `resolved_outcome`, `gross_r`, `cost_scenario`, `net_r`, `ml_target_label`, `resolved_at`, `last_polled_at`, `error`.

## 2. Schema (single additive migration, zero data rewrite)
On `public.shadow_executions`:
- `plan_id uuid` — backfilled, then `NOT NULL`.
- `replay_version smallint not null default 1`, `execution_policy text not null default 'legacy_best_target_touched'`.
- Fill/event time: `fill_bar_time timestamptz`, `event_time_resolution text` (`m15` | `m1` | `none`), `fill_gap_through boolean not null default false`, `fill_ambiguous_tif boolean not null default false`.
- Risk/R: `risk_price_actual numeric`, `gross_r numeric`, `cost_scenario text`, `net_r numeric`.
- Barrier analytics: `first_target_touched smallint`, `max_target_touched smallint`, `tp1_before_stop boolean`, `stop_before_tp1 boolean`.
- Ambiguity: `adjudication text`, `ambiguous_bars integer not null default 0`.
- Indexes/constraints: drop `shadow_executions_signal_id_key`; add `UNIQUE (plan_id, replay_version, execution_policy)`; keep a **partial** unique index on `signal_id WHERE signal_id IS NOT NULL AND replay_version = 1` so legacy one-signal-one-row enrolment stays protected; add `(model_version, replay_version, status)` partial index for the resolver; CHECKs on the enumerated text columns.
- New `public.learning_milestones (replay_version smallint, model_version smallint, gate text, notified_at timestamptz, primary key (replay_version, model_version, gate))`; seed the existing `shadow_engine_state.fill_gate_notified_at` / `win_gate_notified_at` values as `(1, 1, ...)` rows. Legacy columns are left in place, untouched and read-only.
- `shadow_engine_state`: add `active_replay_version smallint not null default 1`, `replay_v2_backfill_enabled boolean not null default false`, `m1_adjudication_enabled boolean not null default false`.
- No RLS change: shadow tables stay service-role only.

### Backfill semantics (idempotent, one statement each)
- Every existing row is, by definition, replay run 1 of its own plan: `UPDATE shadow_executions SET plan_id = id WHERE plan_id IS NULL` — valid for V1 (`signal_id` set), V2 and V3 (`signal_id NULL`) alike, and stable because `id` never changes.
- `replay_version = 1`, `execution_policy = 'legacy_best_target_touched'` come from the defaults; `fill_bar_time = filled_at`, `event_time_resolution = 'm15'` where filled; `risk_price_actual`, `gross_r`, `net_r`, `cost_scenario`, barrier-analytics and adjudication columns stay **NULL** for legacy rows — they were never measured and must not be inferred.
- Legacy `realized_r`, `filled_at`, `ml_target_label`, `resolved_outcome`, `replay_cursor` are never written by this or any later step.
- New enrolment (`shadow_worker.server.ts`, `research/enrol.server.ts`) stamps `plan_id = gen_random_uuid()`, `replay_version = active_replay_version`, and the active policy.

## 3. Execution policy: separate analytics from realized R (option B)
Awarding the highest TP touched in a bar is not executable and will not be named as if it were.
- Legacy rows keep `execution_policy = 'legacy_best_target_touched'` and their existing `realized_r` — explicitly documented as *barrier-touch analytics, not realized P&L*.
- Replay v2 uses one explicit executable policy: **`single_exit_first_target`** — the whole position exits at the first target touched; later touches cannot raise R. Stop → exactly `-1R` on actual risk. Vertical barrier → mark-to-market at the barrier bar close.
- Every replay-v2 row additionally records, independently of the policy: `first_target_touched`, `max_target_touched`, `tp1_before_stop`, `stop_before_tp1`, MFE/MAE in R, `bars_to_outcome`. These support "how far did it run" research without contaminating `gross_r`.
- No partial-allocation percentages are invented. A future scale-out policy is a **new** `execution_policy` value replayed in parallel; the unique key already admits it.
- `ml_target_label` for v2 = 1 when a target is reached before the stop under the active policy, else 0.

## 4. TIF event-time semantics
Candle `time` is the bar **open**; the bar covers `[t, t+15m)`. Deadline `D = detected_at + ORDER_TIF_MINUTES` (30m).
- Bar wholly before `D` (`t + 15m <= D`) and touching the limit → fill. `fill_bar_time = t`, `filled_at = t` (`event_time_resolution = 'm15'`), and the whole event interval is provably `< D`.
- Bar wholly at/after `D` (`t >= D`) → cannot fill. If nothing filled earlier: `never_filled`.
- Bar spanning `D` (`t < D < t+15m`) and touching → `fill_ambiguous_tif = true`; adjudicate on M1 when enabled. An M1 bar whose interval lies entirely before `D` and touches the limit → fill with `filled_at` = that M1 bar open, `event_time_resolution = 'm1'`. An M1 bar spanning `D`, or M1 unavailable → **fail closed**: no fill, `adjudication = 'm1_unavailable'` or `'m1_still_ambiguous'` (+ `conservative_fallback`).
- Acceptance asserts the adjudicated event interval end `<= D`, not merely `bar_open < D`.
- Vertical barrier unchanged (24h after detection, close of the barrier bar). Missing candles/weekend: cursor holds, nothing inferred.

## 5. Ambiguity adjudication (state-dependent)
- **Before fill** the only question is entry sequencing: does the bar reach the limit, and does it do so before `D`? Stop/target levels are irrelevant while no position exists. A bar that contains both the limit and the stop is ambiguous only in the sense of "filled then stopped in the same bar" — that is handled after the fill is established.
- **After fill** the question is stop-vs-target ordering only.
- States: `m15_unambiguous` (only one competing event in the bar) · `m1_resolved` (M1 shows a single competing event first, unambiguously) · `m1_still_ambiguous` (one M1 candle contains competing events — order remains unknowable; **never** recorded as resolved) · `m1_unavailable`. The last two fall back conservatively (stop-first after fill; no-fill for a TIF-spanning bar) and set `conservative_fallback = true` via `adjudication`.
- `ambiguous_bars` counts every bar that required adjudication so the ambiguity rate is measurable and reportable.
- M1 fetches are bounded per cron run and gated by `m1_adjudication_enabled`, so the 8s-per-fetch budget cannot be blown.

## 6. Replay v2 is research-only on first deployment
- `active_replay_version` stays **1**. Production `regime_stats`, priors, EV sorting, the weekly report, the admin headline tiles and the learning gates keep reading replay 1 in this deployment.
- Replay v2 rows are created and resolved in parallel; the only new surface is an admin **paired v1-vs-v2** panel over the same `plan_id` set.
- `recompute_regime_stats` gains `_replay_version` (default = the DB's `active_replay_version`) so promotion is a data/flag change, not a code change.
- All consumers (`weekly.server.ts`, `get_admin_intelligence()`, `signal-audit.functions.ts`, `capture.server.ts`, `export.ts`, `get_shadow_comparison`, `get_performance_summary`) read the active replay version from the DB and stamp it in their output.

## 7. Runtime control and rollback
`shadow_engine_state.active_replay_version` is authoritative; the code constant becomes a fallback default only. Rollback or promotion is a single row update, no deployment. `paused` remains the hard kill switch; the backfill worker and M1 adjudication have independent flags.

## 8. Promotion gates (manual, never automatic)
Promotion 1 → 2 requires an admin-visible report showing all of:
- re-replay coverage of the eligible plan set at the agreed target (default ≥ 99% of resolvable plans, remainder itemised);
- zero duplicate `(plan_id, replay_version, execution_policy)` and zero NULL `plan_id`;
- zero replay-v2 rows with an adjudicated fill interval at/after `D`;
- actual-risk checks: every v2 loss `= -1R` within tolerance, `risk_price_actual > 0`, planned-vs-actual divergence distribution reported;
- ambiguity rate, plus `m1_still_ambiguous` and `m1_unavailable` rates;
- effect on fill/win counts and rates vs replay 1, paired on `plan_id`;
- effect on V1 priors (tier-level `p_fill_shrunk` / `p_win_shrunk` deltas);
- effect on the 150/200 learning gates, including whether either would now be below threshold;
- explicit reviewed-and-accepted acknowledgement recorded in a `baseline_snapshots` row tagged `replay_version = 2`.

Backfill completion alone promotes nothing.

## 9. Milestone latches
Historical emails are facts: `shadow_engine_state.fill_gate_notified_at` / `win_gate_notified_at` are never cleared. `learning_milestones` is keyed by `(replay_version, model_version, gate)` and seeded with the already-sent replay-1 rows, so a replay-2 gate crossing sends at most one new, clearly-labelled email and no duplicate can be produced by re-running the cron. `claim_learning_milestone` gains version arguments and writes to the new table.

## 10. Gap semantics
Only **favorable** gap-through fills are modelled: a limit can fill at or better than its price, never worse. `fill_gap_through` flags them and `execution_slippage_pips` records the improvement magnitude. Adverse (worse-than-limit) fills are impossible for this order type and are **not** modelled; the previously proposed "gap-through worse fill" fixture is rejected and replaced by an assertion that no v2 row has a worse-than-limit fill price.

## 11. Costs
`gross_r` = execution result under the active policy, before modelled costs. `net_r` is populated only under a named scenario row recording `scenario name`, `spread assumption`, `commission assumption`, `swap assumption`, `data provenance`. We have no documented broker cost schedule for this account, so the initial deployment ships `cost_scenario = 'none'` and `net_r = NULL`, and every surface says "net unavailable". Spread-floor constants are stop-construction inputs and will never be presented as observed broker net performance.

## 12. Cohort coverage and scheduling
- The re-replay worker selects plans by `plan_id`, not `signal_id`, so V1 (published), V2 and V3 (research, `signal_id NULL`) cohorts all backfill through one path. `model_version` and `plan_id` stay strictly independent of `replay_version`.
- Explicit per-`(model_version, replay_version)` budgets with production-first ordering: live `(model=1, replay=1)` rows are claimed first and may consume their full allowance; other cohorts get only the remainder.
- Backfill runs in a **separate** bounded worker route with its own budget and flag, so a v2 backlog can never delay live replay-1 resolution.

## 13. Legacy preservation
`replaySetupV1` is the current function, frozen, still covered by the existing blocking characterisation tests. No legacy `realized_r`, `filled_at`, `ml_target_label`, `resolved_outcome` or `replay_cursor` is ever written after this migration; a DB test asserts immutability by checksum before/after backfill.

## 14. Test matrix (blocking unless noted)
- Event time: filled in a bar wholly before `D`; touch in a bar wholly after `D` → `never_filled`; bar spanning `D` with M1 showing the touch before `D` → filled, resolution `m1`; M1 showing the touch after `D` → no fill; single M1 bar containing both limit and deadline → `m1_still_ambiguous`, fail closed; M1 unavailable → `m1_unavailable`, fail closed.
- Policy: first-target exit pays TP1 R even when TP2/TP3 are touched later, while `max_target_touched = 2|3`; stop-only = exactly −1R on actual risk; TP1/TP2/TP3 orderings; stop+TP same bar (m15 stop-first, then M1-resolved variant); entry+stop+TP same bar; vertical expiry positive and negative.
- Risk: favorable gap fill raises R on the same target (fill 1.0990, stop 1.0950, TP1 1.1100 → 2.75R vs planned 2.00R); worse-than-limit fill is unrepresentable; risk 0 / NaN / inverted stop → resolved `never_filled`, never a fabricated label.
- Invariants/property: `gross_r >= net_r` when net exists; a loss is always −1R; replay is idempotent on identical candles; bearish mirror of every geometry case; `first_target_touched <= max_target_touched`; `tp1_before_stop` and `stop_before_tp1` are mutually exclusive.
- DB: `plan_id` backfill covers V1/V2/V3 with no NULLs and no duplicates; `(plan_id, replay_version, execution_policy)` uniqueness; partial `signal_id` uniqueness still blocks double enrolment; legacy rows byte-identical; `recompute_regime_stats` honours `_replay_version` and ignores the other; milestone table prevents a duplicate email; RLS still denies anon/authenticated.
- Failure injection: M1 timeout, duplicate/concurrent cron runs, mid-batch write failure (cursor unchanged), stale cursor, provider 429/504, all-instruments-fail breaker.
- Report-only: the existing `replay.v2.test.ts` `INTENDED_V2` expectations flip to passing assertions against `replaySetupV2` while the V1 characterisation file stays untouched.

## 15. Sequence
1. Baseline snapshot of replay-1 state (fill rate, win rate, priors, gates, weekly report, admin tiles) tagged `replay_version = 1`.
2. Additive migration + `plan_id` backfill + milestone table seed.
3. `replaySetupV2` (TIF gate, actual risk, analytics fields, ambiguity states) with the full test matrix.
4. Version-aware resolver with per-cohort budgets; production-first.
5. Separate bounded backfill worker; enrol every legacy plan as replay 2.
6. `recompute_regime_stats(_replay_version)` — run for replay 2 into a research read only.
7. Admin paired v1-vs-v2 panel, ambiguity tile, gross/net labelling; MCP tools stamp replay version, policy and cost scenario.
8. Review the promotion gates. Promotion, if approved, is a separate step: one row update to `active_replay_version`.

## 16. Known limits
Corrected labels may fall below the 150/200 gates — that is the honest outcome, not a failure. M1 adjudication will leave a residual `m1_still_ambiguous` population. `net_r` stays NULL until a documented cost schedule exists. MetaApi M1 history depth may not reach the oldest samples; those plans stay `m1_unavailable` and are itemised in the coverage gate rather than silently filled.
