# Replay Lifecycle — Final Plan with Execution-Safety Lock (Replay V2 research-only)

Prompt 5D architecture preserved in full: plan identity, prospective + historical dual enrolment, frozen resolved Replay-V1 rows with an operational Replay-V1 resolver, immutable replay-version registry, independent replay/policy dimensions, data-quality outcomes, actual-risk normalisation, separate rereplay worker, baseline first, M15 fill-time epistemics. Prompt 5E items 1–6 folded in.

## 1. Lifecycle

```text
MODEL  V1 (published)   V2 (research)   V3 (research)
                    ↓
        immutable trade plan  (plan_id, geometry, features)
                    ↓
   ┌──────────────────────────────────────────────┐
   │ Replay V1 — current production labels        │  active_replay_version = 1
   │ Replay V2 — corrected research labels        │  research-only
   └──────────────────────────────────────────────┘
                    ↓
        execution policy (legacy_best_target_touched | single_exit_first_target)
                    ↓
        replay result (own id; fill → adjudication → barrier → gross_r → [cost scenario] → net_r)
```

- **Ongoing (prospective).** `AFTER INSERT` trigger on `shadow_executions`, `WHEN NEW.replay_version = 1`, gated by `replay_v2_shadow_enabled`, inserts one Replay-V2 sibling with the same `plan_id`, `status = 'pending'`, `execution_policy = 'single_exit_first_target'`. Fires for all three model cohorts because it hangs off the shadow row, not off `scanned_signals`.
- **Historical (backlog).** Separate flag-gated bounded worker enrols siblings for plans that predate deployment.

## 2. Sibling creation is fail-open (5E-1)
An `AFTER INSERT` trigger runs inside the parent transaction, so a research failure could roll back a production enrolment. The trigger function therefore wraps **all** sibling work in an inner `BEGIN ... EXCEPTION WHEN OTHERS THEN ... END` block that:
- swallows the research exception;
- leaves the Replay-V1 parent row committed and untouched;
- best-effort increments durable research health (`shadow_engine_state.research_errors`, `research_last_error`, `research_last_error_at`) inside its own nested exception block so even that write cannot propagate;
- never re-raises into the production transaction.

`ON CONFLICT DO NOTHING` is kept for idempotency but is explicitly **not** the isolation mechanism. Blocking DB test: force the sibling insert to fail (e.g. a temporarily violated CHECK or a NOT NULL breach injected in the sibling path) and assert the Replay-V1 row is present and complete after commit, with `research_errors` incremented.

### 2a. Sibling starts from a clean execution state (5F-4)
Both the prospective trigger and the historical backfill clone the **immutable plan only**, never the Replay-V1 execution state. Every sibling is explicitly initialised: same `plan_id`, same `model_version` and immutable geometry/features (instrument, grade, direction, `detected_at`, entry/stop/TP ladder, planned R metadata, session, volatility, ATR, `strategy_family`, `quality_grade`, `entry_source`, `stop_anchor`); `replay_version = 2`; `execution_policy = 'single_exit_first_target'`; `status = 'pending'`; `replay_cursor = detected_at`; `filled_at`, `fill_bar_time`, `fill_price`, `execution_slippage_pips`, `risk_price_actual`, `resolved_outcome`, `ml_target_label`, `realized_r`, `gross_r`, `net_r`, `resolved_at`, `bars_to_outcome`, `adjudication`, `error` all NULL; MFE/MAE `= 0`; `bars_replayed = 0`; `ambiguous_bars = 0`; every gap/ambiguity boolean false. Explicit column lists (no `SELECT *`) prevent accidental carry-over.
Blocking test: clone an already-resolved Replay-V1 row and assert the sibling starts at detection with a fully clean execution state.

## 3. `plan_id` lifecycle
`plan_id uuid NOT NULL DEFAULT gen_random_uuid()` — the default keeps `processNextShadowJob`, `enrolV2Shadow` and `enrolV3Shadow` working unchanged. Historical rows backfill `plan_id = id` (all rows; 149 of 326 already have `signal_id IS NULL`). A new plan mints its id exactly once on the first (Replay-V1) insert; every later replay version and execution policy inherits it. Replay-result `id` stays separate. Blocking tests cover all three enrolment paths: id minted, unique per plan, sibling inherits it.

## 4. Replay V1 stays operational
Immutability binds only **already-resolved** Replay-V1 rows. Open/pending Replay-V1 rows keep advancing and keep writing `filled_at`, `fill_price`, `execution_slippage_pips`, `realized_r`, `ml_target_label`, `resolved_outcome`, `replay_cursor`, MFE/MAE, `bars_replayed`, `bars_to_outcome`, `resolved_at`. A `BEFORE UPDATE` trigger rejects changes to those fields when `replay_version = 1 AND status = 'resolved'` (`last_polled_at` stays writable).

## 5. `replay_versions` registry
`replay_versions (replay_version smallint pk, label text, semantics jsonb not null, code_hash text not null, activated_at, retired_at)`; authenticated SELECT, service_role write. Version 1 = `legacy_m15_optimistic`. Version 2 = `m15_fail_closed_actual_risk`, whose `semantics` records: TIF interval rule, detection-bar rule (strictly after `detected_at`, unchanged), actual-risk normalisation rule, favorable-gap-only limit semantics, stop-gap rule (§8), M15 horizontal-ambiguity policy (§7), **same-fill-bar target causality rule (§7a)**, **fill-bar MFE/MAE exclusion rule (§10)**, supported execution policy, gross/net cost convention, and `code_hash` over the v2 replay code plus `ORDER_TIF_MINUTES` / `SIGNAL_MAX_AGE_HOURS`. Once any Replay-V2 row exists, changing any of these — including the two 5F rules — requires Replay V3, enforced by a blocking hash test.

## 6. Uniqueness
Primary `UNIQUE (plan_id, replay_version, execution_policy)`; published-signal idempotency partial unique `(signal_id, replay_version, execution_policy) WHERE signal_id IS NOT NULL`. Replay version and execution policy stay independent.

## 7. M15 horizontal-barrier ambiguity, locked (5E-2)
No M1 adjudication in this release. After fill, if one M15 candle contains **both** the protective stop and TP1, the sequence is unknowable: **stop wins**, `ambiguous_bars += 1`, `adjudication = 'm15_conservative_fallback'`. This holds equally when the entry filled in that same bar and when the position was already open. A post-fill bar containing only one relevant barrier is `m15_unambiguous`. `first_target_touched` / `max_target_touched` are analytics only and may never override the conservative outcome.
Fixtures, bullish and bearish: stop only · TP1 only · stop + TP1 · entry + stop · entry + TP1 · entry + stop + TP1.
Pre-fill bars reason only about entry sequencing and the TIF window; stop/target levels are irrelevant while no position exists.

## 7a. Same-fill-bar target causality (5F-1)
An ordinary (non-gap) limit fill happens at an unknown instant inside its M15 bar, so that bar's favorable extreme cannot be attributed to the post-entry interval.
- **Ordinary intrabar fill + TP touched, no stop in that bar** → the target is **not** credited from the fill bar. `ambiguous_bars += 1`, `adjudication = 'm15_conservative_fallback'`, `fill_bar_excursion_ambiguous = true`; the trade stays open and target adjudication resumes on the **next** candle.
- **Ordinary intrabar fill + stop in that bar** (with or without a target) → the already-approved conservative stop-first result stands: loss, and `ambiguous_bars += 1` when a target was also present.
- **Favorable gap-through fill at the bar open** → the position exists for the whole bar, so same-bar stop and target evaluation proceeds normally (stop still beats target within one bar) and `fill_bar_excursion_ambiguous = false`.
Exact bearish mirror in every case. Fixtures: intrabar entry + TP1 · gap-at-open entry + TP1 · intrabar entry + stop · intrabar entry + stop + TP1 · all four bearish mirrors.


## 8. Stop-gap execution (5E-3)
- Ordinary stop touch (bar does not open beyond the stop) → exit at the stop, `gross_r = −1R` exactly.
- Already-filled position, later bar opens beyond the stop (long `open <= stop_loss`, short `open >= stop_loss`) → exit at the **candle open**, `stop_gap_through = true`, `gross_r = directional(exit − fill_price) / risk_price_actual`, which may be worse than −1R. Stop execution is never fabricated at the stop price when the bar opened beyond it.
- A bar opening favorably beyond TP1 conservatively credits **TP1**, not the open — no price improvement is assumed without verified broker semantics.
- Entry-side extremes keep the 5D rule: a favorable gap-through limit fill is accepted only while the fill stays on the valid side of the stop; a bar whose open is at/through the stop while the order is still working resolves as `gap_beyond_stop` (data quality, NULL label, NULL `gross_r`), never as manufactured geometry.

## 9. Data-quality outcomes
`resolved_outcome` gains `invalid_plan` (non-finite/zero risk, inverted stop, targets on the wrong side, missing entry) and `gap_beyond_stop`. Both: never `never_filled`, `ml_target_label = NULL`, `gross_r = NULL`, excluded from every fill/win denominator (learning reads require `ml_target_label IS NOT NULL`), and reported as research-QA counters alongside `stop_gap_through` and `ambiguous_bars`.

## 10. Actual-risk normalisation and post-fill excursions (5F-2)
`risk_price_actual = |fill_price − stop_loss|` drives **every** post-fill metric: `gross_r`, MFE R, MAE R, target R recomputed from actual target prices, and vertical-barrier mark-to-market R. Planned `risk_price`, `tp1_r/tp2_r/tp3_r`, `max_r` remain immutable plan metadata.
Excursions must be strictly post-fill:
- **Favorable gap-at-open fill** → the fill candle contributes to MFE and MAE (the position existed for the whole bar).
- **Ordinary intrabar fill** → the fill candle contributes **neither** MFE nor MAE, because its extremes may predate entry. Measurement begins with the next M15 candle, and the bar is stamped `fill_bar_excursion_ambiguous = true`.
Blocking test: a fill bar with an extreme high/low set before entry cannot inflate Replay-V2 MFE/MAE (bullish and bearish).


## 11. Reader audit before Replay V2 is enabled (5E-5)
Every `shadow_executions` reader is enumerated and classified as **active-version production read** (must filter `active_replay_version` from the database), **explicit paired research read** (must name both versions), or **intentional raw audit read** (admin-only, explicitly labelled).

| Reader | Class | Action |
| --- | --- | --- |
| `get_admin_intelligence()` (health, fill diagnostic, discipline, grade calibration, taken performance, feed) | production | add `model_version` + active `replay_version` filters to every CTE (closes today's unfiltered V2/V3 hole) |
| `weekly.server.ts` / weekly-report cron | production | add active replay filter, stamp version in the email |
| `signal-audit.functions.ts` | production | add filter |
| `baseline/capture.server.ts` | production | pin and stamp `replay_version` |
| `export.ts` | production | filter + stamp; raw mode only if explicitly labelled |
| `get_shadow_comparison`, `get_performance_summary` (MCP) | production | filter + stamp version, policy, cost scenario |
| learning / SignalCard intelligence (`regime.server.ts`, `explain.ts`, `queries.ts`) | production | reads `regime_stats`, which stays replay-1 only this release — assert no direct unversioned `shadow_executions` read |
| `shadow_resolve.server.ts`, rereplay worker | writers | cohort-scoped by `(model_version, replay_version)` |
| new admin paired panel | paired research | names both versions explicitly |

Blocking guard: a static inventory test greps every SQL function body and TS query for `shadow_executions` and fails unless the call site is on an allow-list that records its class and its version predicate.

## 12. Scheduling and budgets (5F-3)
Model-V1 throughput is never reduced. The prospective resolver keeps its existing 200-row budget and consumes it **hierarchically**: `(model 1, replay 1)` may take the entire 200 rows; only unused capacity flows to `(model 2, replay 1)`, then `(model 3, replay 1)`. No fixed 100/30/30 reservation. Replay-V2 work is not scheduled here at all — both historical and prospective Replay-V2 siblings are resolved by the separate bounded research/rereplay worker (own route, own flag, 50 plans/run, 10s wall clock, single-flight lease, touches only `replay_version = 2`), so research backlog can never displace production rows.
Blocking tests: (a) 180 open `(model 1, replay 1)` rows plus a large Replay-V2 backlog → all 180 production rows are selected in the same 200-row run; (b) 5 + 5 + 5 open rows across the three model cohorts → all 15 advance in one pass.


## 13. Baseline first
Persist the Replay-V1 baseline before the backfill and before consumer filters deploy: resolved/filled/win counts, fill rate, win-if-filled **and** unconditional `p_fill × p_win`, grade/instrument/session/direction cells (`unknown` separate), miss-distance distribution, priors at both learning gates, weekly and admin figures, plus `replay_version = 1`, the registry `code_hash`, and a per-row checksum over the frozen resolved fields. Idempotent via the existing `baseline_snapshots` uniqueness.

## 14. Fill-time epistemics
`fill_bar_time` is a bar-open timestamp; `filled_at_resolution = 'm15'` records the resolution. UI/API/MCP present "fill bar (15m resolution)", never broker execution time. TIF acceptance requires the whole bar interval inside the live-order window (`bar_open + 15m <= detected_at + 30m`); a bar spanning the deadline sets `fill_ambiguous_tif` and fails closed (`m15_conservative_fallback`). `adjudication` already admits `m1_resolved | m1_still_ambiguous | m1_unavailable` for the later adjudication prompt.

## 15. Schema delta (one additive migration)
`shadow_executions`: `plan_id uuid not null default gen_random_uuid()`; `replay_version smallint not null default 1`; `execution_policy text not null default 'legacy_best_target_touched'`; `fill_bar_time timestamptz`; `filled_at_resolution text`; `fill_gap_through boolean not null default false`; `stop_gap_through boolean not null default false`; `fill_ambiguous_tif boolean not null default false`; `fill_bar_excursion_ambiguous boolean not null default false` (5F-2); `risk_price_actual numeric`; `gross_r numeric`; `cost_scenario text`; `net_r numeric`; `first_target_touched smallint`; `max_target_touched smallint`; `tp1_before_stop boolean`; `stop_before_tp1 boolean`; `adjudication text`; `ambiguous_bars integer not null default 0`. Drop `shadow_executions_signal_id_key`; add both uniqueness rules (§6); add `(model_version, replay_version, status)` partial index; CHECKs on enumerated text columns and the widened `resolved_outcome` domain. New `replay_versions` table. `shadow_engine_state`: `active_replay_version smallint not null default 1`, `replay_v2_shadow_enabled boolean not null default false`, `replay_v2_backfill_enabled boolean not null default false`. Triggers: `shadow_replay_v2_sibling` (fail-open §2, clean-state init §2a) and `shadow_v1_resolved_immutable` (§4). `get_admin_intelligence()` rewritten per §11. **No change to `regime_stats`, `recompute_regime_stats`, `claim_learning_milestone` or the milestone latches.**

## 16. Rollback (5E-6)
Operational rollback is non-destructive and needs no deployment: `replay_v2_shadow_enabled = false`, `replay_v2_backfill_enabled = false`, `active_replay_version` stays 1. Replay-V2 research rows are **kept** — they are evidence. Deleting `replay_version <> 1` belongs only to a deliberate schema-uninstall procedure (flags off → delete research rows → drop constraints/columns), documented separately and never invoked as a routine rollback.

## 17. Sequence
1. Baseline capture. 2. Additive migration + `plan_id` backfill + registry seed + **all** consumer filters (§11) deployed together. 3. `replaySetupV2` with the full fixture matrix. 4. Prospective budgets, then `replay_v2_shadow_enabled = true`. 5. `replay_v2_backfill_enabled = true` for the historical worker. 6. Admin paired panel (McNemar on paired labels, QA counters, coverage, gross-only R). 7. Promotion is a separate prompt: `regime_stats` replay dimension, version-specific milestone state, gate report, then one row update to `active_replay_version`.

## 18. Acceptance
1. Legacy resolved Replay-V1 rows byte-identical (checksum + immutability trigger); open Replay-V1 rows still advance normally.
2. Forced sibling failure → Replay-V1 row commits, `research_errors` incremented (5E-1).
3. Exactly one row per `(plan_id, replay_version, execution_policy)`; zero NULL `plan_id`; all three enrolment paths mint an id and receive a sibling.
4. No Replay-V2 fill whose bar interval ends after the deadline.
5. R invariants (5E-4): ordinary stop touch ⇒ exactly −1R; stop-gap-through ⇒ `gross_r <= −1R` computed from the observed bar open; **no** ordinary loss better than −1R; every post-fill R uses `risk_price_actual`.
6. Post-fill bar containing stop + TP1 resolves as a loss with `ambiguous_bars >= 1` and `adjudication = 'm15_conservative_fallback'`, in both directions.
7. `invalid_plan` / `gap_beyond_stop` rows carry NULL labels and appear in no learning denominator.
8. Reader inventory test green: no unversioned production aggregation over `shadow_executions`.
9. Admin, weekly, export and MCP figures unchanged after the backfill.
10. Saturated-backlog test passes; registry hash matches shipped semantics; zero new MetaApi calls; operational rollback rehearsed non-destructively.

## 19. Limits
Corrected labels may fall below the 150/200 gates. Fail-closed TIF and stop-first ambiguity are deliberately pessimistic and their residual bias is unmeasurable until M1 adjudication exists. `net_r` stays NULL without a documented broker cost schedule. The 24h vertical barrier is still fixture-only in production. Ten days of one regime means the paired comparison may be directional rather than decisive.
