# Prompt 6C — Payoff Cohort, Uncertainty and Exposure Lock (final plan, not implemented)

Architecture from the revised Prompt 6 is preserved. All twelve corrections are folded in.
Verified at HEAD before writing: `regime_stats` PK is `(model_version, tier, regime_key)`;
`recompute_regime_stats` has no replay/policy filter; all 335 `shadow_executions` rows are
`(model 1, replay 1, legacy_best_target_touched)` with `gross_r` NULL; `replay_versions.semantics`
holds only `{"frozen":true,"registered_by":"prompt-5g"}` and
`{"research_only":true,"registered_by":"prompt-5g"}` — placeholder JSON, confirming §11.

## Release 6A — safety and truth (ships first, one atomic release)

**6A.1 Replay-contamination filter.** `recompute_regime_stats` constrains the production
learning source to the active production semantics, declared as named constants in the function:
`replay_version = 1 AND execution_policy = 'legacy_best_target_touched' AND model_version = mv AND
status = 'resolved'`. `regime_stats` stays structurally unchanged (no new columns, PK untouched).

**6A.2 Advisory lock + frozen source snapshot.** First statement after
`pg_advisory_xact_lock(hashtext('recompute_regime_stats'), mv)` captures
`as_of := clock_timestamp()` and materialises the eligible source rows **once** into `_src`
(`... AND resolved_at <= as_of`). Every later statement in the run reads only `_src`, so
siblings or resolutions committed mid-run cannot change the denominators. `as_of` is returned in
the result JSON and written to `regime_snapshots.computed_at` for that run.

**6A.3 NULL semantics deployed atomically with TypeScript.** SQL stops emitting `0.5` for empty
denominators (`p_fill_shrunk`/`p_win_shrunk` become NULL) **in the same release** as:
`clamp01` → `finiteOrNull`; `RegimeStatRow.p_fill_shrunk`/`p_win_shrunk` typed
`number | null`; `summarize` returns `pFill: number | null`, `pWin: number | null`,
`status: 'active' | 'learning' | 'unavailable'` and a `reason` code. No `Number(null) → 0` path
survives. Consumers updated in the same commit: `SignalCard.tsx`, `feed.tsx`, `explain.ts`,
`regime.server.ts`, `milestone.server.ts`, `get-intelligence.ts`, `pipeline.server.ts`,
`LearningHistory.tsx`, `AdminPanels.tsx`. Any null → "Insufficient data", never a number.

**6A.4 `pJoint` rename with dual-write.** `RegimePrior.ev` → `pJoint`, documented as
"estimated joint win probability = P(fill) × P(TP1+ | filled) — a probability, not a return".
`scanned_signals` gains `p_joint_prior`; `ev_prior` keeps being written with its **original**
semantics and is never redefined or backfilled. Readers prefer `p_joint_prior` and fall back to
`ev_prior` for older rows. Both columns are added to `SIGNAL_COLUMNS` and to the explicit column
list in `capture.server.ts`, and baseline payloads gain `schema_version`.

**6A.5 Truthful wording.** SignalCard tile → **"Estimated joint win probability"**, subtitle
"P(fill) × P(TP1+ | filled) — model estimate, not an observed rate, not a return"; chip label
`WIN-P`. Optional feed sort renamed **"by win probability"** and requires **both** the fill and
win sample gates (today it gates on the fill count alone). **Default feed ordering stays
`recent`, unchanged** — asserted by test.

**6A.6 MCP deprecation metadata.** `expected_value` keeps returning the joint probability plus
`expected_value_deprecated: true` and
`expected_value_semantics: "p_fill_times_p_win_if_filled_probability"`; adds
`joint_win_probability`, and `expected_r: null` with `expected_r_status`. Tool description and
the agent page state the removal condition. No key is removed in 6A.

**6A.7 Research-isolation drift fix (before Replay-V2 is ever enabled).**
`create_replay_v2_sibling` gets a **nested** exception handler around the
`shadow_engine_state` telemetry update, so a failing health write cannot propagate and cannot
roll back the Replay-V1 parent insert. `replay_versions.semantics` is replaced with the full
immutable manifest mirrored from the TypeScript registry (TIF rule, gap-through fill and stop
rules, ambiguity adjudication, causality rules, MFE/MAE post-fill rule, execution policy, R
formula, code hash), and a blocking test asserts DB JSON equals the TypeScript manifest and that
`code_hash` matches.

## Release 6B — payoff research plumbing (admin/service-role only)

**6B.1 Mature cohort, not "resolved rows".** At `as_of`, a plan is **mature** when
`detected_at + tif + replay_horizon <= as_of` (horizon from the replay manifest). Per bucket the
payoff aggregate stores `n_mature`, `n_resolved_eligible`, `n_unresolved_mature`,
`coverage = n_resolved_eligible / n_mature`, and `n_data_quality_excluded`. Resolution speed
therefore cannot select the sample. Expected R stays NULL with
`stat_status = 'learning'` while `coverage < 0.95` (declared threshold, stored per row).

**6B.2 Economic denominator.** Valid `never_filled` contributes **0R**. Valid filled/expiry
outcomes contribute the execution policy's **gross R**. `invalid_plan`, `gap_beyond_stop` and any
`data_quality_outcome` are **excluded** from the denominator and counted in
`n_data_quality_excluded` — never treated as 0R.

**6B.3 Provenance and no cohort merging.** New tables `payoff_stats` and `payoff_snapshots`,
PK `(model_version, replay_version, execution_policy, tier, regime_key)`, with `payoff_basis`
(`replay_v2_gross_r_single_exit_first_target` | `legacy_v1_realized_r_best_target_touched`),
`credibility` (`execution_credible` | `non_execution_credible_legacy`), and `computed_as_of`.
Legacy V1 `realized_r` is stored **only** as an admin diagnostic and always labelled
non-execution-credible. Aggregation never unions the two bases.

**6B.4 Uncertainty, descriptive vs promotion.** Stored per row: `mean_r`, `sd_r`, `se_r`,
`ci_lo`, `ci_hi`, `ci_method` (`t_descriptive` | `cluster_instrument_day` | `block_bootstrap`),
`ci_level`, `cluster_n`. A `t_descriptive` interval is research-only and **cannot** unlock public
Expected R — overlapping setups on one instrument-day are not IID. Promotion requires a
dependence-aware interval (instrument-day clustering, or a block bootstrap that has been tested
against the clustered result), `n_mature >= 200`, `cluster_n >= 30`, and CI half-width ≤ 0.15R.
`n_filled >= 100` remains a floor for conditional `E[R|fill]` only, not for unconditional
Expected R.

**6B.5 Exposure lock.** `GRANT SELECT ON payoff_stats, payoff_snapshots TO service_role` only —
no `authenticated`, no `anon`; RLS enabled with an `is_admin()` read policy. Ordinary users see
payoff data only through a narrow `public.get_public_expected_r(signal_id)` security-definer RPC
that returns a value **only** when every public gate passes and otherwise returns
`{status:'unavailable', reason}`.

**6B.6 One maths module.** `src/lib/learning/payoff.ts` owns every payoff computation;
`weekly.server.ts` imports it instead of computing expectancy a second way.

## Promotion (6C, separate approval — not in this implementation)

Public Expected R renders only when **all** hold: cohort `replay_version` and
`execution_policy` equal the currently approved production semantics; `payoff_model_enabled` is
true; coverage, `n_mature`, `cluster_n` and CI-width criteria pass; `credibility =
execution_credible`. Until Replay V2 + `single_exit_first_target` is explicitly promoted, its
Expected R is admin research only. `payoff_model_enabled` alone is never sufficient.

## Acceptance criteria (all blocking)

1. Synthetic Replay-V2 sibling row inserted → **no** `regime_stats` value changes (DB test).
2. A resolution committed mid-recompute does not alter that run's denominators; `as_of` stamped.
3. No `0.5` literal remains in `learning/*` or in `recompute_regime_stats`; grep-asserted.
   Null statistics render as "Insufficient data" everywhere, never as `0`.
4. `ev_prior` semantics unchanged and never backfilled; `p_joint_prior` written alongside; old
   rows fall back correctly.
5. Signal count, grades, entry/SL/TP values, alert fan-out, webhook dispatch and **default feed
   order** unchanged over a fixed candle fixture.
6. `regime_stats` values byte-identical before/after 6A and 6B (no siblings exist today).
7. A normal authenticated client **cannot** read `payoff_stats`/`payoff_snapshots` rows,
   including legacy-policy Expected R; only the gated RPC returns anything.
8. Payoff row with `coverage < threshold` → `ev_r` NULL, `stat_status='learning'`.
9. `never_filled` valid → 0R in the denominator; `invalid_plan`/`gap_beyond_stop` excluded and
   counted; legacy and V2 bases never appear in one aggregate.
10. A `t_descriptive` interval cannot satisfy the promotion gate; missing `cluster_n` blocks it.
11. Failure injection: sibling insert fails **and** telemetry update fails → Replay-V1 parent
    insert still commits.
12. `replay_versions.semantics` equals the TypeScript manifest for V1 and V2, hashes match.
13. MCP response still carries `expected_value` with deprecation metadata; `expected_r` is NULL
    until public gates pass.
14. Migrations apply twice idempotently; no column dropped; zero additional MetaApi calls.

## Rollback

6A is subtractive of falsehoods and reversible by code revert; the SQL filter and lock can be
reverted by `CREATE OR REPLACE`. 6B tables can be dropped without touching production data.
`ev_prior`, `shadow_executions` and existing snapshots are never rewritten.

## Remaining risks

Replay-V2 may not reach `n_mature >= 200` with `cluster_n >= 30` for a long time; Expected R
stays dark, which is the honest outcome. Legacy payoff numbers remain in the database and are
protected only by the policy key, grants and labelling. Coverage thresholds and the replay
horizon are declared parameters, not derived. `regime_stats` remains destructively rebuilt each
hour; only snapshots retain history. The `executed_trades` cascade on signal purge still
survivorship-filters user-reported metrics — documented, not changed here.
