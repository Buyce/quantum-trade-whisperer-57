# Replay Lifecycle — Final Plan (Replay V2 research-only, prospective + historical)

Prompt 5C architecture preserved: plan identity, TIF correction, actual-risk normalisation, frozen legacy labels, gross/net separation, research-only V2, DB-controlled active replay version, manual promotion. Corrections 1–12 below are folded in.

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

Two creation paths, deliberately separate:
- **Ongoing (prospective).** Every new trade plan gets a Replay-V1 row (production, unchanged) **and** a Replay-V2 sibling row, created by an `AFTER INSERT` trigger on `shadow_executions` (`replay_v2_shadow_enabled` flag, `WHEN NEW.replay_version = 1`) that inserts one sibling with the same `plan_id`, `status = 'pending'`, `execution_policy = 'single_exit_first_target'`, `ON CONFLICT DO NOTHING`. In-transaction, pure insert, no network, no latency — mirroring the existing `enroll_shadow_signal` pattern. It is idempotent (unique triple), bounded (exactly one sibling per plan) and cannot fail the V1 path: the trigger only ever inserts, and a conflict is a no-op. Covers all three model cohorts because it fires on the shadow row, not on `scanned_signals`.
- **Historical (backlog).** A separate flag-gated bounded worker enrols Replay-V2 siblings for plans that already existed at deployment.

## 2. `plan_id` lifecycle
- Column `plan_id uuid NOT NULL DEFAULT gen_random_uuid()`. The default is what keeps the three existing insert paths (`processNextShadowJob`, `enrolV2Shadow`, `enrolV3Shadow`) working unchanged after `NOT NULL` — none of them needs to know the column exists.
- Historical rows: `plan_id = id` (one-time backfill, every row, no `signal_id` filter — 149 of 326 production rows already have `signal_id IS NULL`).
- New plans: the plan id is minted exactly once, by the first (Replay-V1) insert. Every later replay version and execution policy for that plan inherits it via the trigger or the backfill worker. The replay-result `id` stays independent.
- Blocking tests: one per enrolment path (V1 worker, V2 enrol, V3 enrol) asserting a plan_id is minted, is unique per plan, and that the V2 sibling carries the identical value.

## 3. Replay V1 stays operational
Immutability applies **only to already-resolved** Replay-V1 rows. The production resolver is not frozen: open/pending Replay-V1 rows keep advancing and keep writing `filled_at`, `fill_price`, `execution_slippage_pips`, `realized_r`, `ml_target_label`, `resolved_outcome`, `replay_cursor`, `max_favorable_excursion_r`, `max_adverse_excursion_r`, `bars_replayed`, `bars_to_outcome`, `resolved_at`. A `BEFORE UPDATE` trigger rejects changes to those fields when the row is `replay_version = 1 AND status = 'resolved'` (`last_polled_at` remains writable), so immutability is enforced by the database rather than by discipline.

## 4. `replay_versions` registry (immutable provenance)
`public.replay_versions (replay_version smallint pk, label text, semantics jsonb not null, code_hash text not null, activated_at timestamptz not null default now(), retired_at timestamptz)`; authenticated SELECT, service_role write. Seeded with:
- **1** — `legacy_m15_optimistic`: fill on any bar whose open precedes the deadline; planned-risk R; best-target-touched analytics; favorable gap fills; no ambiguity accounting.
- **2** — `m15_fail_closed_actual_risk`, `semantics` recording: TIF interval rule (whole bar interval inside the live-order window); detection-bar rule (strictly after `detected_at`, unchanged from V1); actual-risk normalisation rule; favorable-gap-only limit semantics; ambiguity / fail-closed policy; supported execution policy (`single_exit_first_target`); gross/net cost convention; and `code_hash` over `replay.ts` v2 code plus `ORDER_TIF_MINUTES` / `SIGNAL_MAX_AGE_HOURS`. Once any Replay-V2 row exists, changing any of these requires Replay V3 — enforced by a blocking test comparing the computed hash against the registry row.

## 5. Uniqueness
- Primary: `UNIQUE (plan_id, replay_version, execution_policy)`.
- Published-signal idempotency: partial unique `(signal_id, replay_version, execution_policy) WHERE signal_id IS NOT NULL` — keeps the worker's `23505` "already enrolled" path alive at any active version and leaves room for parallel execution policies.
- Replay version and execution policy stay independent dimensions; neither is derivable from the other.

## 6. Data-quality outcomes (not market results)
`resolved_outcome` gains `invalid_plan` and `gap_beyond_stop`:
- `invalid_plan` — non-finite or zero risk, inverted stop, targets on the wrong side, missing entry. Never `never_filled`; `ml_target_label = NULL`; `gross_r = NULL`.
- `gap_beyond_stop` (see §8).
Both are excluded from every fill and win denominator (learning reads require `ml_target_label IS NOT NULL`), and both are surfaced as research-QA counters in the admin paired panel. A blocking test asserts each learning/report query excludes them.

## 7. Actual-risk normalisation, everywhere post-fill
Replay V2 computes `risk_price_actual = |fill_price − stop_loss|` and uses it for **every** post-fill metric: `gross_r`, MFE R, MAE R, target R recomputed from the actual target prices, and the vertical-barrier mark-to-market R. Planned `risk_price`, `tp1_r/tp2_r/tp3_r`, `max_r` stay immutable plan metadata and are never overwritten. A stop reached from valid geometry is exactly −1R by construction (invariant test).

## 8. Extreme gap behaviour
A favorable gap-through fill is accepted only while the fill price stays on the valid side of the protective stop. If a long limit's bar opens at or below its stop (or a short's at or above), the "fill then stop" sequence is unknowable from OHLC and no ordinary actual-risk geometry may be manufactured: resolve as `gap_beyond_stop`, `ml_target_label = NULL`, `gross_r = NULL`, `risk_price_actual = NULL`, excluded from learning, counted in QA. Broker stop execution is never inferred from OHLC. Fixtures: long gap open between entry and stop (valid, R rises); long gap open exactly at stop (`gap_beyond_stop`); long gap open below stop (`gap_beyond_stop`); bearish mirrors. Worse-than-limit fills remain unrepresentable.

## 9. Scheduling and budgets
- **Prospective resolver** (`shadow-resolve` cron, hourly) — claims in this fixed order, each with its own budget out of 200 rows/run: `(model 1, replay 1)` 100 → `(model 2, replay 1)` 30 → `(model 3, replay 1)` 30 → spare capacity to `(*, replay 2)` only if all three production queues are empty.
- **Historical rereplay worker** — its own route, its own flag (`replay_v2_backfill_enabled`), its own bounded batch (50 plans/run, 10s wall clock), its own schedule, and a single-flight lease so two runs cannot overlap. It only ever enrols/advances `replay_version = 2` rows.
- Test: with a saturated historical backlog (300 open replay-2 rows) plus 5 open rows in each of the three production cohorts, every production row advances in the first prospective pass and no production cohort is delayed.

## 10. Baseline before anything else
Capture and persist the Replay-V1 baseline **before** the backfill and before consumer filters deploy: resolved/filled/win counts, fill rate, win-if-filled *and* unconditional `p_fill × p_win`, grade/instrument/session/direction cells (`unknown` kept separate), miss-distance distribution, priors at both learning gates, weekly-report and admin figures, plus `replay_version = 1`, the registry `code_hash`, and a per-row checksum over the frozen resolved fields. Stored in `baseline_snapshots` with its existing uniqueness so a re-run is a no-op.

## 11. Fill-time epistemics
Under M15-only Replay V2, `fill_bar_time` is a **bar-open** timestamp and `filled_at_resolution = 'm15'` records that. UI, API and MCP present it as "fill bar (15m resolution)", never as broker execution time. TIF acceptance requires the whole bar interval to lie inside the live-order window (`bar_open + 15m ≤ detected_at + 30m`); a bar spanning the deadline sets `fill_ambiguous_tif` and fails closed (`adjudication = 'm15_conservative_fallback'`). M1 adjudication is a later prompt; `adjudication` already admits `m1_resolved | m1_still_ambiguous | m1_unavailable` without migration.

## 12. Schema delta (one additive migration)
`shadow_executions`: `plan_id uuid not null default gen_random_uuid()`; `replay_version smallint not null default 1`; `execution_policy text not null default 'legacy_best_target_touched'`; `fill_bar_time timestamptz`; `filled_at_resolution text`; `fill_gap_through boolean not null default false`; `fill_ambiguous_tif boolean not null default false`; `risk_price_actual numeric`; `gross_r numeric`; `cost_scenario text`; `net_r numeric`; `first_target_touched smallint`; `max_target_touched smallint`; `tp1_before_stop boolean`; `stop_before_tp1 boolean`; `adjudication text`; `ambiguous_bars integer not null default 0`. Drop `shadow_executions_signal_id_key`; add the two uniqueness rules from §5; add `(model_version, replay_version, status)` partial index; CHECKs on the enumerated text columns and on the widened `resolved_outcome` domain. New `replay_versions` table (§4). `shadow_engine_state`: `active_replay_version smallint not null default 1`, `replay_v2_shadow_enabled boolean not null default false`, `replay_v2_backfill_enabled boolean not null default false`. New trigger `shadow_replay_v2_sibling` (§1) and `shadow_v1_resolved_immutable` (§3). `get_admin_intelligence()` rewritten to filter `model_version` and `replay_version = active_replay_version` in every `shadow_executions` CTE (closes the existing unfiltered V2/V3 hole). **No change to `regime_stats`, `recompute_regime_stats`, `claim_learning_milestone` or the milestone latches** — Replay V2 never feeds production learning in this release.

## 13. Sequence
1. Baseline capture (§10). 2. Additive migration + `plan_id` backfill + registry seed + consumer filters, deployed together. 3. `replaySetupV2` with the full fixture matrix. 4. Prospective resolver budgets + sibling trigger enabled. 5. Historical rereplay worker enabled. 6. Admin paired panel (McNemar on paired labels, QA counters, coverage, gross-only R). 7. Promotion is a separate prompt: `regime_stats` replay dimension, version-specific milestone state, gate report, then one row update to `active_replay_version`.

## 14. Acceptance
Legacy resolved rows byte-identical (checksum + immutability trigger); every plan has exactly one row per `(replay_version, execution_policy)`; all three enrolment paths mint a plan id and receive a V2 sibling; no replay-2 fill whose bar interval ends after the deadline; every valid-geometry loss exactly −1R on actual risk; `invalid_plan` / `gap_beyond_stop` rows carry NULL labels and appear in no learning denominator; saturated-backlog test passes; admin/weekly/MCP figures unchanged after the backfill; registry hash matches the shipped v2 semantics; zero new MetaApi calls; rollback rehearsed (flag → delete `replay_version <> 1` → drop constraints/columns).

## 15. Limits
Corrected labels may fall below the 150/200 gates. Fail-closed TIF is mildly pessimistic and the residual is unmeasurable until M1 adjudication exists. `net_r` stays NULL with no documented broker cost schedule. The 24h vertical barrier is still fixture-only in production. Ten days of one regime means the paired comparison may be directional rather than decisive.
