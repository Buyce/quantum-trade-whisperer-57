# Prompt 6D — Final Payoff Estimand, Transaction and Access Lock (implement 6A + 6B only)

Prompt-6C architecture is preserved; 6A is unchanged in design. All ten 6D corrections are folded
in. Verified at HEAD: `SIGNAL_MAX_AGE_HOURS = 24`, `ORDER_TIF_MINUTES = 30`; Replay V2's vertical
barrier is `detected_at + SIGNAL_MAX_AGE_HOURS` (so TIF is already inside that horizon);
`replay_versions.semantics` holds placeholder JSON only; `shadow_executions` contains **zero**
Replay-V2 rows; all 335 rows are `(model 1, replay 1, legacy_best_target_touched)`.

## Release 6A — safety and truth (unchanged from 6C, one atomic release)

1. **Replay-contamination filter.** `recompute_regime_stats` constrains production learning to
   the active production tuple, declared as constants in the function:
   `replay_version = 1 AND execution_policy = 'legacy_best_target_touched' AND model_version = mv
   AND status = 'resolved'`. `regime_stats` stays structurally unchanged.
2. **Advisory lock + frozen snapshot.** `pg_advisory_xact_lock(hashtext('recompute_regime_stats'),
   mv)`, then one `as_of := clock_timestamp()` for the whole run (see §5 below for the two
   materialised sources). Every statement reads only the frozen sources.
3. **NULL semantics deployed atomically with TypeScript.** SQL stops emitting `0.5`;
   `clamp01` → `finiteOrNull`; `p_fill_shrunk`/`p_win_shrunk` typed `number | null`;
   `RegimePrior` gains `status` (`active | learning | unavailable`) and `reason`. Every consumer
   (`SignalCard`, `feed`, `explain`, `regime.server`, `milestone.server`, `get-intelligence`,
   `pipeline.server`, `LearningHistory`, `AdminPanels`) understands null in the same commit. No
   `Number(null) → 0` path survives.
4. **`pJoint` rename with dual-write.** `RegimePrior.ev` → `pJoint`. `scanned_signals` gains
   `p_joint_prior`; `ev_prior` keeps its original P(fill) × P(win|fill) meaning, is still written,
   and is never redefined or backfilled. Readers prefer `p_joint_prior`, fall back to `ev_prior`.
   Both added to `SIGNAL_COLUMNS` and to `capture.server.ts`'s explicit list;
   baseline payloads gain `schema_version`.
5. **Truthful wording.** Tile → "Estimated joint win probability", subtitle
   "P(fill) × P(TP1+ | filled) — a model estimate, not an observed rate and not a return";
   chip `WIN-P`. Optional sort renamed "by win probability" and requires **both** gates.
   **Default feed order stays `recent`**, asserted by test.
6. **MCP deprecation metadata.** `expected_value` still returns the joint probability with
   `expected_value_deprecated: true` and
   `expected_value_semantics: "p_fill_times_p_win_if_filled_probability"`; adds
   `joint_win_probability` and `expected_r: null` + `expected_r_status`. No key removed.
7. **Research-isolation drift fix.** `create_replay_v2_sibling`: the
   `shadow_engine_state` telemetry update is wrapped in its **own nested** exception block, so a
   failed sibling *and* a failed telemetry write both leave the Replay-V1 parent insert committed.

## 6D corrections folded into 6B

**§1 Maturity from the manifest's terminal horizon.** `terminal_replay_horizon` is read from the
immutable replay-version semantics — for Replay V2 that is `SIGNAL_MAX_AGE_HOURS = 24h` measured
from `detected_at`. TIF is **not** added again (it lies inside the horizon).
`mature_at = detected_at + terminal_replay_horizon`. Fixture: a plan detected at `T` with a
24h-from-detection horizon is mature at exactly `T + 24h`, and **not** at `T + 24h + 30m`; a plan
at `T + 24h − 1s` is not yet mature.

**§2 Replay coverage ≠ economic eligibility.** Per cohort store `n_mature`, `n_resolved_total`,
`n_unresolved_mature`, `n_data_quality_excluded`, `n_economic_eligible`, and
`replay_coverage = n_resolved_total / n_mature`. A resolved `invalid_plan` / `gap_beyond_stop` row
counts toward replay completeness while being excluded from the economic estimator.

**§3 Predeclared estimand.** Headline research quantity is **`mean_r_per_plan` =
E[R per generated trade plan]**, over economically eligible plans where valid `never_filled`
contributes **0R** and valid filled/expiry contributes execution-policy gross R.
`invalid_plan` is excluded from both estimands (no plan existed).
`gap_beyond_stop` **is included at 0R** in `mean_r_per_plan`, because fail-closed execution means
no position was taken — adverse gap events are never silently dropped from the unconditional
number. `mean_r_given_executable` is stored alongside as the conditional companion, explicitly
labelled conditional, and is not the headline. Both carry their own denominators.

**§4 SQL owns the estimator.** Inside the locked transaction, PostgreSQL computes cohort
membership, all counts, sums/moments, `mean_r`, `sd_r`, `se_r`, the descriptive t-interval,
`replay_coverage` and provenance. `src/lib/learning/payoff.ts` owns only shared types,
finite/null validation, status/reason interpretation, promotion/public gating and UI formatting —
it never recomputes the estimator from raw executions. `weekly.server.ts` and every admin reader
consume `payoff_stats`; no second expectancy formula exists anywhere.

**§5 Two frozen sources, one `as_of`.** After the lock:
`_regime_src` = production Replay-V1 + legacy-policy **resolved** rows only;
`_payoff_src` = the complete candidate payoff cohort per `(model, replay, policy)`, including
**unresolved mature** rows needed for coverage. Both materialised at the same `as_of`. Every
`regime_stats`, `regime_snapshots`, `payoff_stats` and `payoff_snapshots` row from that run is
stamped `computed_as_of = as_of`.

**§6 Access.** `payoff_stats` / `payoff_snapshots`: `GRANT`s to `service_role` only; no
`authenticated`, no `anon`; RLS enabled with no permissive authenticated policy (grants, not
policies, are the gate). The admin UI reads through one narrow `SECURITY DEFINER` RPC
`get_admin_payoff_research()` that first checks `is_admin()`, has `SET search_path = public`,
`REVOKE EXECUTE ... FROM PUBLIC, anon`, `GRANT EXECUTE ... TO authenticated`.
**No `get_public_expected_r()` in 6B.** MCP keeps returning `expected_r: null`. The public RPC is
created only at explicit promotion.

**§7 No canonisation of Replay-V2 drift.** Because zero Replay-V2 rows exist, V2 is corrected
in place *before* enabling: Replay V2 ends execution at TP1, so undefined post-exit TP2/TP3
analytics (`maxTargetTouched` beyond TP1, `ambiguous_bar_target_touch` deeper-ladder indices) are
removed from both the engine and `REPLAY_V2_SEMANTICS`, then the deterministic V2 hash is
regenerated, the full semantics JSON is seeded into `replay_versions`, and blocking tests assert
DB JSON equals the approved TypeScript manifest and DB `code_hash` equals the code hash. If any
Replay-V2 outcome row exists at implementation time, V2 is frozen untouched and the correction
becomes Replay V3 instead.

**§8 No dependence-aware CI in 6B.** 6B computes only `ci_method = 't_descriptive'` with
`ci_level`, `cluster_n` (instrument-day count, recorded as provenance only) and the interval.
That interval is admin research and **permanently fails** the promotion gate by construction.
No `cluster_instrument_day` or block-bootstrap formula is implemented; methodology, finite-sample
correction and thresholds are 6C work requiring a separate reviewed statistical specification.

**§9 Atomic production tuple.** Production stays
`(replay_version = 1, execution_policy = 'legacy_best_target_touched')`. `active_execution_policy`
is **deferred to 6C**; nothing runtime-visible is added now. Any future promotion must move
replay version and execution policy together as one tuple — enforced by a test that reads both
from a single constant.

**Provenance columns** on `payoff_stats` / `payoff_snapshots`: PK
`(model_version, replay_version, execution_policy, tier, regime_key)`, plus `payoff_basis`
(`replay_v2_gross_r_single_exit_first_target` | `legacy_v1_realized_r_best_target_touched`),
`credibility` (`execution_credible` | `non_execution_credible_legacy`), `estimand`
(`per_plan` | `given_executable`), `terminal_replay_horizon_hours`, `computed_as_of`,
`coverage_threshold`, `stat_status`, `reason`. Legacy V1 `realized_r` is admin diagnostic only and
never unioned with V2 `gross_r`.

## Acceptance criteria (all blocking)

1. Synthetic Replay-V2 sibling changes **no** `regime_stats` value.
2. A resolution committed mid-recompute does not alter that run's denominators; `as_of` stamped on
   all four tables.
3. No `0.5` literal in `learning/*` or `recompute_regime_stats`; nulls render as
   "Insufficient data", never `0`.
4. `ev_prior` semantics unchanged, never backfilled; `p_joint_prior` dual-written; old-row
   fallback proven.
5. Signal count, grades, entry/SL/TP, alerts, webhook dispatch and **default feed order**
   unchanged on a fixed candle fixture; `regime_stats` values byte-identical across 6A/6B.
6. Maturity fixture: mature at `T + 24h`, not `T + 24h + TIF`.
7. `replay_coverage = n_resolved_total / n_mature`; a resolved `gap_beyond_stop` row raises
   coverage and does **not** enter `n_economic_eligible`.
8. `mean_r_per_plan` includes valid `never_filled` and `gap_beyond_stop` at 0R and excludes
   `invalid_plan`; `mean_r_given_executable` is separately denominated and labelled conditional.
9. `payoff.ts` contains no aggregation of raw `shadow_executions` (grep-asserted); weekly report
   and admin panels read `payoff_stats` only.
10. A normal authenticated client cannot select from `payoff_stats`/`payoff_snapshots`;
    the admin RPC returns rows only for `is_admin()`; `anon`/`PUBLIC` cannot execute it.
11. `get_public_expected_r` does not exist; MCP `expected_r` is null.
12. `ci_method = 't_descriptive'` never satisfies the promotion gate.
13. Replay-V2 manifest: no post-TP1 analytics; DB JSON equals TypeScript manifest; DB hash equals
    code hash; a pre-existing V2 outcome row would force V3 instead (test asserts the guard).
14. Failure injection: sibling insert failure **and** telemetry write failure leave the Replay-V1
    parent insert committed.
15. Migrations idempotent on re-apply; no column dropped; zero additional MetaApi calls.

## Rollback

6A is reversible by code revert plus `CREATE OR REPLACE` of the function. 6B tables and the admin
RPC are droppable with no production data touched. `ev_prior`, `shadow_executions` and existing
snapshots are never rewritten.

## Remaining risks

Replay V2 must accrue mature rows before any payoff number means anything; Expected R stays dark
and non-public throughout 6A/6B. `coverage_threshold` and the horizon are declared parameters.
Legacy payoff diagnostics remain in the database, protected by grants, the policy key and
labelling. `regime_stats` is still rebuilt destructively each hour. The `executed_trades` cascade
on signal purge still survivorship-filters user-reported metrics — documented, unchanged here.
