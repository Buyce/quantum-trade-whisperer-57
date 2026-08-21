# Red-Team Review of the Expected-Value Remediation Plan (revised plan, not implemented)

Reviewed as an independent reader against repository HEAD and live data. The previous plan
survives in outline but contains four defects serious enough to change the design, one of which
is an **existing production contamination bug** the plan would have shipped on top of.

## Evidence re-read at HEAD

- `regime_stats` PK is `(model_version, tier, regime_key)`. No `replay_version`,
  no `execution_policy`, no payoff column.
- `recompute_regime_stats` selects `FROM shadow_executions WHERE status='resolved' AND
  model_version = mv` — **no `replay_version` filter**.
- `shadow_executions` today: 335 rows, all `model_version=1`, `replay_version=1`,
  `execution_policy='legacy_best_target_touched'`. `gross_r`/`net_r`/`adjudication` are NULL on
  every row. Replay-V2 and model 2/3 cohorts are **empty**.
- Resolved 329: filled 94 (28.57%), wins 48, `mean R|fill = +0.0149`,
  unconditional `mean R = +0.00426`, wins pay 0.65R–2.00R.
- `EXECUTION_POLICY_LEGACY = "legacy_best_target_touched"` in `replay-registry.ts`;
  Replay-V2 is `single_exit_first_target`.
- Tier sample depth: tier 2 max 32 filled; tier 3 = 50 buckets, mean 1.9 filled, max 9.
- Grade cohorts: A n=3/1 filled; B n=246/75 filled, mean R|fill +0.0169; C n=80/18 filled,
  mean R|fill **−0.0483**.
- FKs to `scanned_signals`: `executed_trades` **ON DELETE CASCADE**; `shadow_executions`
  **ON DELETE SET NULL**.
- Consumers: `pipeline.server.ts:499` (`ev_prior`), `feed.tsx:159-167` (EV sort, gated on
  `MIN_N_FILL` only), `SignalCard.tsx:262` ("Expected value") and `:722-727` (EV chip),
  `get-intelligence.ts:115` (`expected_value`), `capture.server.ts:247` (explicit column list),
  `queries.ts:8` (`SIGNAL_COLUMNS`).

## A. Plan defects discovered

**A1 (critical, pre-existing, must ship independently of EV work).** `recompute_regime_stats`
has no `replay_version` filter. The Replay-V2 sibling trigger clones every plan. The moment
Replay-V2 enrolment turns on, each plan appears **twice** in `_base`: `n_total` inflates, the
samples are not independent (identical plan, different execution semantics), and V1 fill/win
priors change silently with no code change and no version bump. My plan buried this filter
inside a large EV migration; it belongs in its own minimal migration, first.

**A2 (critical).** The plan proposed computing and displaying "Expected R" from the only payoff
data that exists — `legacy_best_target_touched`. That policy credits the **best target touched**
on the path, which is exactly the credit rule Replay-V2 was built to replace. Wins paying up to
2.0R are best-case path selection, so `E[R|fill] = +0.0149` is an **upper** bound, not an
estimate. Publishing it under the more authoritative label "Expected R" would make the product
more confidently wrong than the mislabelled probability it replaces. Replay-V2 has zero resolved
rows, so there is currently **no credible payoff sample at all**.

**A3 (major).** Grade banding of the hierarchy is a trading-model change dressed as a
statistics fix. Tier 3 already averages 1.9 filled samples; banding by grade multiplies keys and
makes every specific bucket unanswerable. It also closes a feedback loop (grade → prior →
future grading/ranking) and would fit a cohort with **one** filled A sample. Rejected in the
revision: grade becomes an admin-only diagnostic cut, never a live lookup key in this change.

**A4 (major).** Widening the `regime_stats` primary key is backwards-incompatible and
effectively irreversible; every reader, the DELETE/INSERT rebuild, and `regime_snapshots`
comparisons assume the current 3-column identity. Simpler design: **leave `regime_stats`
untouched** and put payoff statistics in a new sibling table keyed by
`(model_version, replay_version, execution_policy, tier, regime_key)`.

**A5 (moderate).** The estimator was over-engineered. `pFill × E[R|fill]` needs a covariance
term (both factors are estimated on the same rows) and a normal CI on a two-point-mass payoff
(−1 / +0.65..2) at n=94 is a poor approximation. The **unconditional mean of R over all resolved
rows** (R = 0 when unfilled) is the same quantity, unbiased, needs no decomposition, and its
interval is directly computable: mean +0.00426, sd ≈ 0.416, SE ≈ 0.023, t-CI ≈ [−0.041, +0.049].

**A6 (moderate).** Breaking the MCP key `expected_value` outright would silently break already
registered agents. A deprecation window with explicit semantics metadata is required.

**A7 (moderate).** `capture.server.ts:247` uses an explicit column list, so new prior columns
must be added there or Checkpoint comparisons quietly drift; snapshot payloads need a
`schema_version` so old and new baselines are not diffed as if they were the same shape.

**A8 (moderate, pre-existing, in scope for disclosure).** `executed_trades` cascades on
`scanned_signals` deletion, and tiered purge deletes signals at 24/36/48h. User-reported wins are
therefore **survivorship-filtered**, so the admin "user-reported win rate" and any cross-check
against expected R is biased by construction. Must be labelled, and the cascade re-examined in a
separate change (not silently altered here).

**A9 (minor).** The advisory lock had no key. Specify
`pg_advisory_xact_lock(hashtext('recompute_regime_stats'), model_version)`.

**A10 (minor).** No assertion existed that signal *count* is unchanged. Needed, since the whole
point is that learning stays advisory.

## Searched-for risks — findings

| Risk | Finding |
|---|---|
| Simpler superior design | Yes — A4 (sibling table) and A5 (unconditional mean). Adopted. |
| Backwards incompatibility | A4 (PK), A6 (MCP key), A7 (baseline column list). |
| Trading-model change disguised as a fix | A3 (grade-keyed priors). Removed. |
| Lookahead bias | A2 — best-target-touched credit is path-optimal selection. |
| Data leakage | A1 — replay siblings double-count the same plan. |
| Selection bias | A8 — purge cascade truncates user-reported outcomes; also C-grade cohort is the only negative-payoff cohort and would be pooled away. |
| Backtest overfitting | A3; also tier-3 payoff estimates at n≈2 — forbidden by the precision floor. |
| Invalid statistical assumptions | A5 — normality and independence of the two factors. |
| Incorrect R mathematics | Original defect D1/D2 confirmed; ladder credit inflates R (A2). |
| Race conditions | Overlapping recompute (A9); sibling trigger inserting mid-aggregate — mitigated by the transaction plus a `computed_at` cutoff on the source read. |
| Duplicated business logic | Payoff maths must live only in `learning/payoff.ts`; `weekly.server.ts` must import it rather than recompute expectancy a second way. |
| RLS weakness | New table needs an explicit policy **and** `GRANT SELECT` to `authenticated`, `ALL` to `service_role`; otherwise the scanner and UI break with a permission error. Admin research cut goes through `is_admin()`. |
| SSRF / auth | No new outbound calls, no new public routes. MCP change is read-only aggregates. |
| Serverless lifecycle | Recompute stays one SQL transaction; no long-lived state, no new provider call, well inside CPU budget. |
| Partial writes | Single transaction per model version; sibling table written in the same transaction. |
| Migration irreversibility | Avoided by dropping the PK change; new table is droppable; no column drops; `ev_prior` never rewritten. |
| Historical contamination | A1; plus forward-only computation, no backfill of `regime_snapshots`. |
| Alert/delivery regressions | A third milestone gate would email on a new threshold — needs its own claim key in `claim_learning_milestone`, and the weekly report copy must not change numbers. |
| MCP semantic regressions | A6 — deprecation window instead of a hard rename. |
| False UI wording | "Expected value / fill x win" is false today; the fix must not replace it with an equally false "Expected R" (A2). |
| MetaApi cost | Unchanged — zero additional provider calls. |
| Signal count | Unchanged; asserted by test (A10). |

## Major decisions — why this option

**1. Headline estimator = unconditional mean realized R (R = 0 when unfilled).**
*Why:* it is the definition of expected return per published setup, unbiased, one estimator, one
interval. *Alternatives:* (a) `pFill × E[R|fill]` with delta-method CI — rejected: needs a
covariance term and adds a second source of truth that can disagree with the weekly report;
(b) hierarchical Bayesian payoff model — rejected: no sampler in the Worker runtime and it buys
precision the data cannot justify. *Evidence:* n=329, SE 0.023 vs SE 0.072 on the conditional
mean. *Would change my mind:* payoff distribution becoming strongly multi-modal per regime, or a
need to price fill and payoff improvements separately — then keep the decomposition as the
headline. The decomposition is still **displayed as explanation**, explicitly non-identity.

**2. Payoff statistics keyed by execution policy, and no "Expected R" shown until a
`single_exit_first_target` sample exists.** *Why:* A2. *Alternatives:* (a) ship EV_R from the
legacy ladder with a caveat — rejected: caveats do not survive a screenshot; (b) retro-score the
existing 94 fills as 1R-at-first-target — rejected: that is a re-labelled backtest of a replay
engine, computed outside the audited replay path, i.e. exactly the leakage the replay versioning
exists to prevent. *Evidence:* wins span 0.65–2.0R under legacy credit; Replay-V2 exists
precisely because that credit is not execution-credible. *Would change my mind:* Replay-V2
resolving ≥100 filled siblings with a stable fill rate — then promote it to the headline.

**3. New sibling table instead of widening `regime_stats`.** *Why:* A4, byte-stable V1
identity. *Alternatives:* (a) widen the PK — rejected as irreversible and reader-breaking;
(b) encode policy inside `regime_key` — rejected: silently changes every existing key's meaning
and defeats indexing. *Evidence:* PK confirmed 3-column; rebuild is DELETE+INSERT.
*Would change my mind:* if the scanner needed both statistics in a single round trip for latency
— measured first; today it already reads one small table and can read two.

**4. Rename-first, compute-behind-flag.** *Why:* the false wording is live and costs nothing to
remove; the new number needs evidence it does not yet have. *Alternatives:* (a) ship both at
once — rejected: couples an honest deletion to an unproven statistic; (b) leave wording until
data arrives — rejected: keeps a false claim in front of users for weeks.
*Evidence:* the tile currently reads 14.6% while measured expectancy is +0.004R.

**5. Precision gate = fixed floor AND interval budget.** *Why:* either alone fails (narrow CI at
n=3; wide CI at n=200). *Alternatives:* fixed N only (status quo, D4/D6) or CI only — both
rejected above. *Would change my mind:* evidence that the interval estimator is unreliable at
the sample sizes reached; then fall back to a pure floor and publish it.

## Failure scenarios the architecture must survive

**S1 — Replay-V2 enrolment turns on mid-week.** Siblings appear; recompute now filtered to
`replay_version = 1 AND execution_policy = 'legacy_best_target_touched'`. Expected: V1 fill/win
values byte-identical to the pre-enrolment run; V2 payoff rows accumulate in the sibling table
with `stat_status='learning'`; nothing reaches the UI until the flag flips. Failure signature if
the filter is missing: `n_total` roughly doubles and the global fill rate moves.

**S2 — Hourly cron and a manual admin recompute collide.** Both take
`pg_advisory_xact_lock(hashtext('recompute_regime_stats'), mv)`; second waits, then rebuilds
from the same source. Expected: exactly one row per key, no unique violation, no partial
`regime_stats`. Also covered: recompute aborted mid-transaction leaves the previous hour intact.

**S3 — Purge deletes signals during aggregation.** `shadow_executions.signal_id` is
`SET NULL`, so training rows survive with denormalized instrument/grade/session; aggregates read
`shadow_executions` only and never join `scanned_signals`. Expected: sample counts unaffected by
purge. The `executed_trades` cascade (A8) is documented as a known bias, not silently patched.

**S4 — A cohort turns genuinely negative.** C-grade is already at −0.048R mean-R-given-fill.
Expected: negative expected R renders as a negative number with its interval, is never clamped
to zero, and never suppresses or promotes a signal (advisory only).

**S5 — Statistics unavailable.** Empty cohort, NaN volatility, missing payoff moment, or a
non-finite division all yield `null` + `stat_status='unavailable'` with a reason code. No 0.5
fallback survives in TypeScript or SQL. UI shows "Insufficient data"; MCP omits the field.

## B. Revised plan

**Step 1 — Leakage filter (own migration, ship first, no UI change).**
`recompute_regime_stats`: add `AND replay_version = 1 AND execution_policy =
'legacy_best_target_touched'`, add the advisory lock, and replace both `0.5` fallbacks with
`NULL` (callers already gate on n). Prove the global tier is numerically unchanged today
(no siblings exist yet), so this is a pure future-proofing fix.

**Step 2 — Fail-closed maths.** `learning/regime.ts`: `clamp01` returns `null` instead of 0.5;
`RegimePrior.ev` renamed to `pJoint` with the comment corrected to "P(fill AND win) — a
probability, not a return"; add `status` and reason codes. Replace the characterisation test
that pins `ev = pFill*pWin` with a `pJoint` test and a note in `docs/CHARACTERISATION.md`.

**Step 3 — Wording truth pass (ships on, no new statistic).**
`SignalCard.tsx:262` tile → "Joint win probability" with subtitle "P(fill and reach TP1)";
chip → `WIN-P`; `feed.tsx` sort label → "by win probability" and its gate widened to require
**both** the fill and win gates (today it ranks on an ungated win term). No signal-count or
grading change.

**Step 4 — Payoff statistics, research-only.** New table `payoff_stats`
(`model_version, replay_version, execution_policy, tier, regime_key` PK) with
`n_resolved, n_filled, mean_r, sd_r, se_r, ev_r_lo, ev_r_hi, mean_r_given_fill, sd_r_given_fill,
stat_status, computed_at`, plus `payoff_snapshots` for history. Explicit RLS policy and
`GRANT SELECT` to `authenticated`, `GRANT ALL` to `service_role`. Populated in the same
transaction as `recompute_regime_stats`, per policy present in the data. Single maths module
`learning/payoff.ts`; `weekly.server.ts` imports it instead of computing expectancy separately.
Grade appears only as an **admin research cut** (`is_admin()`), floored at 30 filled samples.

**Step 5 — Signal-level priors (additive, nullable).** `scanned_signals`:
`p_joint_prior`, `ev_r_prior`, `ev_r_lo_prior`, `ev_r_hi_prior`, `payoff_sample_n`,
`payoff_policy`, `ev_status`. `ev_prior` frozen forever. Add the new columns to
`SIGNAL_COLUMNS` and `capture.server.ts:247`, and stamp baseline payloads with
`schema_version`.

**Step 6 — MCP deprecation window.** Keep `expected_value` returning the joint probability plus
`expected_value_deprecated: true` and
`expected_value_semantics: "p_fill_times_p_win_probability"`; add `joint_win_probability`,
`expected_r`, `expected_r_ci`, `payoff_policy`, `payoff_sample_n`, `ev_status`. Tool description
and the agent instructions page state the removal condition. Remove only after that window.

**Step 7 — Promotion gate (not part of this change's user-visible surface).** "Expected R" is
rendered only when `payoff_policy = 'single_exit_first_target'`, `n_filled >= 100`, the CI
half-width is ≤ 0.15R, and `shadow_engine_state.payoff_model_enabled` is true. Third milestone
email uses a new `claim_learning_milestone('payoff')` key.

Not doing: PK widening, grade-keyed live priors, any backfill, any retro-scoring of legacy fills,
any change to grading, entry/stop/target geometry, alert fan-out, caps, or the purge cascade.

## C. New acceptance criteria

1. `recompute_regime_stats` filters replay version and policy; a synthetic sibling row does not
   change any `regime_stats` value (blocking DB test).
2. Global-tier fill/win values are byte-identical before and after Steps 1–5.
3. No `0.5` literal fallback remains in `learning/*` or in the recompute function; grep-asserted.
4. Nothing in the product labels a probability as expected value or R; the EV sort requires both
   gates; the collapsed chip never shows a percentage under an R label.
5. `payoff_stats` exists with RLS + grants; an `authenticated` client can read it; `anon` cannot.
6. No `ev_r` value derived from `legacy_best_target_touched` is reachable by a non-admin.
7. Expected R is expressed in R, always with an interval, `null` when gated; negative values
   render as negative.
8. Signal count and grade distribution over a fixed candle fixture are unchanged (blocking test).
9. Weekly report and `get_admin_intelligence` figures numerically unchanged for Replay-V1.
10. Payoff maths exists in exactly one module; the weekly report imports it.
11. Migration applies twice idempotently; no column dropped; `ev_prior` untouched.
12. MCP response still contains `expected_value` with deprecation metadata plus the new fields.
13. Unit fixtures: unconditional mean over the live cohort = `+0.00426` (±1e-5) with
    CI ≈ [−0.041, +0.049]; the ladder-vs-1R fixture proves higher win probability can mean lower
    expected R; an all-loss cohort yields a negative headline.
14. Zero additional MetaApi calls; recompute stays a single transaction.

## D. Remaining risks

Legacy-policy payoff numbers exist in the database and could be misread by a future developer
(mitigated by the mandatory `execution_policy` key and admin-only exposure). Replay-V2 may never
accrue 100 filled samples at the current rate (~94 fills over the whole V1 history), so
"Expected R" may stay dark for a long time — that is the honest outcome, not a bug. Between-tier
shrinkage of a payoff mean remains unvalidated until there is data to validate it. `regime_stats`
is still rebuilt destructively each hour; only `regime_snapshots`/`payoff_snapshots` preserve
history. A8's survivorship bias in user-reported metrics remains open.

## E. Confidence

**High (design):** the four defects are grounded in facts re-read at HEAD — the missing replay
filter, the single legacy execution policy on all 335 rows, the 3-column PK, and tier-3 sparsity.
Steps 1–3 are strictly subtractive of false claims and cannot change trading behaviour.
**Medium (statistics):** the estimator is right, but every interval rests on 329 resolved and 94
filled samples; regime-level payoff conclusions are not yet supportable.
**Low (edge discovery):** current evidence puts expected R at ~+0.004R with an interval straddling
zero; this work will most likely show that no edge is yet demonstrated.

## F. What still cannot be guaranteed

That a credible payoff sample will exist soon, or ever, under Replay-V2. That the legacy 94 fills
carry any information about a 1R-single-exit policy. That normal/t intervals are exact on a
two-point-mass payoff. That MetaApi candle quality does not bias fills. That agents reading
`expected_value` will interpret the deprecation metadata. That the purge cascade has not already
destroyed user-reported outcomes that would change the cross-check. That expected R will be
positive.

**Recommendation:** approve Steps 1–3 for immediate implementation (they only remove falsehoods
and a live leakage path), approve Steps 4–6 as research-only plumbing, and hold Step 7 until
Replay-V2 evidence exists.
