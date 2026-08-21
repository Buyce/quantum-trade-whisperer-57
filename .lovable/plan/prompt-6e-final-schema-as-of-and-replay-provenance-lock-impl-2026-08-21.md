# Prompt 6E — Final Schema, As-Of and Replay-Provenance Lock (implement 6A + 6B)

Prompt 6D is preserved; no architectural redesign. All nine 6E corrections are folded in.
Pre-plan evidence measured at HEAD:

- `shadow_executions`: 335 rows, 329 resolved. **`resolved_at IS NULL` on resolved rows: 0.**
  Earliest `resolved_at` 2026-08-18 15:39:11Z. So `resolved_at` is a safe historical cutoff and
  no legacy training observation is lost — the documented legacy rule below still ships, but has
  an empty subject set today.
- **Replay-V2 rows (any status): 0** → the in-place V2 correction path in §6/§7 is available.
- All rows are `(model_version 1, replay_version 1, legacy_best_target_touched)`.
- `SIGNAL_MAX_AGE_HOURS = 24`, `ORDER_TIF_MINUTES = 30`; V2's vertical barrier is
  `detected_at + 24h`, so TIF is inside the terminal horizon.
- `replay_versions.semantics` currently holds placeholder JSON for both versions.

## 6A — safety and truth release (unchanged design)

1. **Contamination filter + model lock (§5).** `recompute_regime_stats` sources exactly
   `(model_version = 1, replay_version = 1, execution_policy = 'legacy_best_target_touched',
   status = 'resolved')`. The function **rejects/no-ops for `_model_version <> 1`**, returning
   `{"skipped":"model_version_not_promoted"}` without writing. No V2/V3 rows can ever reach live
   `regime_stats`. `regime_stats` stays structurally unchanged.
2. **Advisory lock + one `as_of`.** `pg_advisory_xact_lock(hashtext('recompute_regime_stats'), 1)`,
   then `as_of := clock_timestamp()` for the whole run. `regime_stats.computed_at` and
   `regime_snapshots.computed_at` are stamped with that `as_of` — **no `computed_as_of` column is
   added to either table (§3)**; only the new payoff tables carry `computed_as_of`, and it holds
   the same value, so one timestamp identifies the entire run.
3. **NULL statistical semantics, deployed atomically with TypeScript.** SQL stops fabricating
   `0.5` for empty denominators (NULL instead); `clamp01` → `finiteOrNull`;
   `p_fill_shrunk`/`p_win_shrunk` typed `number | null`; `RegimePrior` gains
   `status` (`active | learning | unavailable`) and `reason`. Same commit updates every consumer:
   `SignalCard`, `feed`, `explain`, `regime.server`, `milestone.server`, `get-intelligence`,
   `pipeline.server`, `LearningHistory`, `AdminPanels`. No `Number(null) → 0` path survives.
4. **`pJoint` rename with dual-write.** `RegimePrior.ev` → `pJoint`. `scanned_signals` gains
   `p_joint_prior`; `ev_prior` keeps its original P(fill) × P(win|fill) meaning, is still written,
   is never redefined or backfilled; readers prefer `p_joint_prior` and fall back to `ev_prior`.
   Both added to `SIGNAL_COLUMNS` and `capture.server.ts`; baselines gain `schema_version`.
5. **Truthful wording.** Tile → "Estimated joint win probability", subtitle
   "P(fill) × P(TP1+ | filled) — a model estimate, not an observed rate and not a return";
   chip `WIN-P`. Optional sort renamed "by win probability", requires **both** gates.
   **Default feed order stays `recent`.**
6. **MCP.** `expected_value` still returns the joint probability with
   `expected_value_deprecated: true` and
   `expected_value_semantics: "p_fill_times_p_win_if_filled_probability"`; adds
   `joint_win_probability`, `expected_r: null`, `expected_r_status`. No key removed.
7. **Sibling telemetry fail-open.** `create_replay_v2_sibling` wraps the
   `shadow_engine_state` health update in its own nested exception block, so a failed sibling and
   a failed telemetry write both leave the Replay-V1 parent insert committed.

## 6B — admin-only payoff research plumbing

**§1 Table identity.**
`payoff_stats` PK `(model_version, replay_version, execution_policy, estimand, tier, regime_key)`.
`payoff_snapshots` is append-only with its own surrogate `id`, a recompute `run_id`, and a UNIQUE
constraint on `(run_id, model_version, replay_version, execution_policy, estimand, tier,
regime_key)` — never the current-state PK.

**§2 Denominators (contradiction resolved).** Counters stored per cohort:
`n_mature`, `n_resolved_total`, `n_unresolved_mature`, `n_per_plan_eligible`, `n_executable`,
`n_invalid_excluded`, `n_gap_no_trade`, and `replay_coverage = n_resolved_total / n_mature`.
- `invalid_plan`: excluded from **both** estimands, counted in `n_invalid_excluded`.
- `gap_beyond_stop`: counts as a **resolved replay**, contributes **0R** to the per-plan headline
  (it is *eligible*, not excluded), and is **absent** from `given_executable`; counted in
  `n_gap_no_trade`.
- Valid `never_filled`: 0R in per-plan; absent from `given_executable`.
- Valid filled/expiry: execution-policy gross R in both.
Headline estimand is predeclared `per_plan` (`mean_r_per_plan`); `mean_r_given_executable` is
stored as the labelled conditional companion. `estimand` is part of the PK so both coexist.

**§4 Point-in-time `_payoff_src`.** Two frozen sources under the one lock and one `as_of`:
`_regime_src` = production tuple resolved rows only; `_payoff_src` = the full candidate cohort with
`detected_at <= as_of`, including unresolved mature rows for coverage. A row counts as resolved for
that run only when `resolved_at <= as_of`; `resolved_at > as_of` is treated as unresolved.
**Legacy rule (documented, currently empty):** a row with `status='resolved'` and
`resolved_at IS NULL` predates resolution stamping and is treated as resolved at
`coalesce(resolved_at, last_polled_at, detected_at + terminal_horizon)`, counted in
`n_legacy_resolved_at_null` per cohort so it is never silently dropped. Migration evidence records
today's count: **0**.

**Maturity (from 6D §1).** `mature_at = detected_at + terminal_replay_horizon`, the horizon read
from the immutable replay-version semantics (24h from detection for V2). TIF is not added again.
Fixture: mature at exactly `T + 24h`, not `T + 24h + 30m`.

**Ownership (6D §4).** PostgreSQL owns cohort membership, counts, moments, `mean_r`, `sd_r`,
`se_r`, the descriptive t-interval, coverage and provenance, all inside the locked transaction.
`src/lib/learning/payoff.ts` owns types, finite/null validation, status/reason interpretation,
gating and formatting only, and never re-aggregates raw executions. `weekly.server.ts` and admin
readers consume `payoff_stats`; no second expectancy formula exists.

**Uncertainty (6D §8).** 6B stores only `ci_method = 't_descriptive'` with `ci_level`, `cluster_n`
(instrument-day count, provenance only), `ci_lo`, `ci_hi`. That interval is admin research and
**permanently fails** the promotion gate. No clustered or bootstrap estimator is implemented.

**Access (6D §6).** `payoff_stats` / `payoff_snapshots`: grants to `service_role` only; RLS enabled
with no permissive authenticated policy. Admin UI reads one `SECURITY DEFINER`
`get_admin_payoff_research()` that checks `is_admin()`, `SET search_path = public`, with
`REVOKE EXECUTE FROM PUBLIC, anon` and `GRANT EXECUTE TO authenticated`.
**No `get_public_expected_r()` is created.** MCP keeps `expected_r: null`.

**Provenance columns.** `payoff_basis`
(`replay_v2_gross_r_single_exit_first_target` | `legacy_v1_realized_r_best_target_touched`),
`credibility` (`execution_credible` | `non_execution_credible_legacy`), `estimand`,
`terminal_replay_horizon_hours`, `coverage_threshold`, `computed_as_of`, `run_id`,
`stat_status`, `reason`. Legacy V1 `realized_r` is admin diagnostic only and never unioned with
V2 `gross_r`.

**§9 Production tuple.** Stays `(replay_version = 1, execution_policy =
'legacy_best_target_touched')`. `active_execution_policy` deferred to 6C. Replay version and
execution policy may only ever be promoted together, asserted by test.

## §6 Replay-V2 mutation guard

Before any in-place V2 correction, in one transaction: assert
`NOT EXISTS (SELECT 1 FROM shadow_executions WHERE replay_version = 2)` — **any** row, including
`pending`/`open`, freezes V2 — and require `replay_v2_shadow_enabled = false` for the duration.
If the assertion fails, the mutation aborts and the correction becomes **Replay V3**. Measured
now: 0 V2 rows, so the in-place path is open.

## §7 Detection-bar reconciliation before registry seeding

End-to-end characterisation first: enrolment insert (`replay_cursor = detected_at`, per the
sibling/enrolment path) → `replaySetup`'s `fresh` test (`replayCursor == null`) → the first
candle actually consumed. The current V1 manifest sentence "the forming detection bar is replayed
on a fresh run" is **not** copied into the DB unless the traced lifecycle proves it; if enrolment
always sets a non-null cursor, the DB semantics record the true rule
(`cursor-based: first candle with time > replay_cursor`) and V1 numerical behaviour stays frozen —
no V1 code is changed to make a manifest sentence true.
For Replay V2 (zero rows), one approved detection-bar rule is aligned across the sibling/research
initial cursor, `replaySetupV2`, `REPLAY_V2_SEMANTICS`, the regenerated deterministic hash, and the
seeded DB JSON. The undefined post-TP1 analytics (`maxTargetTouched` beyond TP1 and deeper-ladder
`ambiguous_bar_target_touch`) are removed from engine and semantics before hashing, since
execution ends at TP1. Blocking fixture pins the exact first candle consumed under both the V1
characterisation and the V2 specification.

## §8 Baseline acceptance (reworded)

1. Every statistically defined count and probability in `regime_stats` is unchanged.
2. Fabricated `0.5` values on empty denominators become **NULL only** — no other value moves.
3. `computed_at` changes only to the frozen run `as_of`.
4. Signal count, grades, entry/SL/TP, alert fan-out, webhook dispatch and **default feed order**
   are unchanged on a fixed candle fixture.

## Additional blocking acceptance criteria

5. `recompute_regime_stats(2)` and `(3)` write nothing and report skipped.
6. A synthetic Replay-V2 sibling changes no `regime_stats` value.
7. A resolution committed mid-run, and a row with `resolved_at > as_of`, both count as unresolved
   for that run; one `as_of`/`run_id` identifies every row written by the run.
8. `payoff_snapshots` accepts two runs for the same regime key; `payoff_stats` rejects a duplicate
   `(model, replay, policy, estimand, tier, regime_key)`.
9. `gap_beyond_stop` raises `replay_coverage`, appears in `n_per_plan_eligible` at 0R and in
   `n_gap_no_trade`, and is absent from `n_executable`; `invalid_plan` is in neither estimand.
10. Maturity fixture: `T + 24h`, not `T + 24h + TIF`.
11. `payoff.ts` performs no aggregation of raw `shadow_executions` (grep-asserted).
12. A normal authenticated client cannot select from either payoff table; the admin RPC returns
    rows only for `is_admin()`; `anon`/`PUBLIC` cannot execute it; `get_public_expected_r` does not
    exist; MCP `expected_r` is null.
13. `ci_method='t_descriptive'` never satisfies the promotion gate.
14. V2-row precondition asserted; DB semantics JSON equals the approved TypeScript manifest and DB
    `code_hash` equals the regenerated code hash for V1 and V2; detection-bar first-candle fixture
    passes for both.
15. Sibling insert failure **and** telemetry failure leave the Replay-V1 parent committed.
16. Migrations idempotent on re-apply; no column dropped; `ev_prior` untouched; zero additional
    MetaApi calls.

## Deliverables on completion

Exact migration SQL, blocking/report test counts before and after, baseline deltas under the §8
wording, V1/V2 manifest hashes, the V2-row precondition result, the `resolved_at IS NULL` legacy
count, and the post-deploy value of every flag (`v2_enabled`, `v3_enabled`,
`replay_v2_shadow_enabled`, `active_replay_version`, `payoff_model_enabled`).

## Rollback

6A reverts by code revert plus `CREATE OR REPLACE`; 6B tables and the admin RPC drop cleanly with
no production data touched. `ev_prior`, `shadow_executions` and existing snapshots are never
rewritten.
