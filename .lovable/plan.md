# Red-Team Review of the Research Engine Plan (second pass)

Reviewed independently against repository HEAD and live database state. Two claims in the previous plan were false, one design decision was over-engineered, and one migration step was unnecessary. The core architecture survives; the plan below is the corrected version.

## A. Plan defects discovered

**A1. False provenance claim (factual error).** The previous plan said the 156 `shadow_executions` rows with `signal_id IS NULL` have unknown provenance because "the FK is NO ACTION". Verified at HEAD: the constraint is `ON DELETE SET NULL`. Live counts confirm it — 341 shadow rows, 185 with a `signal_id`, and exactly 185 rows in `scanned_signals`; all 156 unlinked rows are older than the longest retention window. They are ordinary production rows whose signals were hard-deleted by `purge_expired_signals`. There is no mystery cohort, and Stage 1 of the old plan ("investigate provenance before touching aggregates") is deleted.

**A2. But the same fact creates a real hazard the old plan missed.** Because purge sets `signal_id` to NULL, `signal_id IS NULL` can never be used to distinguish research rows from production rows — not now and not later. Any candidate design that leans on nullable `signal_id` as an implicit discriminator is wrong. The `cohort` column must be `NOT NULL DEFAULT 'production'`, backfilled in the same migration, and it must be the *only* discriminator.

**A3. Cohort filtering by convention is not enforceable.** The old plan required every aggregate to "add a cohort filter". That is exactly the class of defect the plan claims to fix: one forgotten `WHERE` contaminates trader-facing priors, and nothing fails loudly. Corrected: production reads go through a `shadow_executions_production` view (or a partial index plus a `cohort` column inside every aggregate PK), and a DB test asserts that a research row inserted into `shadow_executions` changes zero values in `regime_stats` and `payoff_stats`.

**A4. `create_replay_v2_sibling` will fan out candidates.** The trigger fires on every `shadow_executions` insert with `replay_version = 1` and clones a V2 sibling when `replay_v2_shadow_enabled` is on. Candidate inserts would silently double. The trigger must gate on `cohort = 'production'`.

**A5. Empirical-Bayes k was smuggled in as a fix.** Replacing k=30 with a moment-estimated `k_fill`/`k_win` changes the trading model's displayed probabilities. It is not a bug fix and does not belong in the same plan as bias removal. Split out entirely; not in scope here.

**A6. Tier-2.5 grade bucket was scope creep.** It adds a tier to the live lookup that traders see, for a hypothesis this plan cannot yet test. Removed.

**A7. Aggregate PK change was proposed as irreversible-by-omission.** Adding `cohort`/`manifest_hash` to `payoff_stats` and `regime_stats` PKs is a destructive-ish migration on tables that are fully rebuildable from `*_snapshots`. Corrected: rebuild-from-snapshot is the documented rollback, and the migration recreates the previous function bodies verbatim in a paired down-migration file kept in the repo.

**A8. `strategy_manifests` + `manifest_hash` in every PK is heavier than the problem.** Candidates are captured from one code path with one hash. Corrected: a single `manifest_hash text NOT NULL` column on `research_candidates` only, and a documented rule that lift is computed within one hash. No new manifest table until a second candidate generation exists.

## B. Design decisions, re-argued

**B1. Refactor V1 into `evaluateSetup()` returning a labelled stage — keep `buildTradeProfile()` as a thin adapter.**
Why: one geometry implementation, so a V1 fix cannot fail to reach research.
Alternatives: (i) a parallel candidate evaluator — rejected, it duplicates the exact business logic that V2/V3 manifests already showed drifts; (ii) leave V1 alone and infer rejection stage from `model_observations.reason` — rejected, all 24 V1 no-trade rows carry one identical string, so the stage is not recoverable.
Evidence: six distinct `return null` sites in `src/lib/scanner/profile.ts` collapse to one label today.
Would change my mind: a byte-for-byte fixture regression that cannot be made to pass — then the parallel evaluator becomes the safer trade.

**B2. Forward-test candidates through existing `shadow_executions` with `cohort`, not a new table.**
Why: replay, ambiguity adjudication, maturity, coverage and payoff maths already exist and are keyed by `(plan_id, replay_version, execution_policy)`.
Alternatives: (i) `candidate_executions` table — rejected, ~800 lines of duplicated replay logic that will drift; (ii) no forward-testing, capture features only — rejected, it cannot answer the question, though it is the correct *first* stage.
Evidence: A3/A4 are the real costs of reuse and both are now closed by enforcement rather than convention.
Would change my mind: if the DB test in A3 cannot be made to fail on a deliberately unfiltered aggregate, the isolation is unproven and the separate table wins.

**B3. Capture-only first, enrolment behind a DB switch, lift last.**
Why: candidate capture writes no rows any trader, alert, MCP tool or aggregate reads, so its blast radius is the write itself.
Alternatives: (i) ship capture + enrolment together — rejected, the fill/CPU profile of rejected structures is unknown until measured; (ii) simulate candidates offline from stored candles — rejected, no candle archive exists.
Evidence: `RESEARCH_MAX_ROWS_PER_RUN = 60` and a 2s CPU envelope; candidate volume per cycle is currently unmeasured.
Would change my mind: measured candidate volume under ~3 rows per instrument per cycle would justify merging the stages.

**B4. Zero extra MetaApi calls.**
`shadow_resolve.server.ts` fetches one 1000-bar M15 series per instrument per run and replays every row against that shared array. Candidates ride the same array. Cost is CPU and row budget only.

## C. Failure scenarios the architecture must survive

1. **Aggregate written without a cohort filter.** A research row is inserted in a test; `recompute_regime_stats` and `recompute_payoff_stats` must produce numerically identical output (p_fill 0.281437, p_win 0.510638, mean R per plan -0.028590). If any value moves, CI fails.
2. **Retention purge runs mid-experiment.** `purge_expired_signals` nulls `signal_id` on candidate-adjacent rows too. `cohort` is unaffected, so classification survives; a test asserts cohort integrity after a simulated purge.
3. **Replay-V2 switch flipped on while candidates exist.** The sibling trigger must clone production rows only, and `recompute_regime_stats` must filter `replay_version = 1`. Test: enable the flag, insert one production and one candidate row, assert exactly one sibling and unchanged live priors.
4. **Candidate write fails or the job nears its deadline.** Research writes are best-effort with a soft budget: on error or budget breach the candidate is dropped, `research_errors` increments, and the published signal, alerts, push, webhook and journal are byte-identical.
5. **Duplicate cron invocation / worker retry.** Capture is idempotent on `(run_id, instrument, direction, strategy_version)`; enrolment claims through a candidate-specific model slot so it cannot steal V2/V3 cooldowns in `v2_structure_claims`.

## D. Revised plan (implementation order)

**Stage 1 — Statistical correctness of the existing engine (no new tables).**
- Add `replay_version = 1` and `execution_policy` filters to `recompute_regime_stats` (defect: latent double-count).
- Freeze volatility tercile boundaries as a versioned definition so tier-3 bucket membership stops drifting between rebuilds; the rebuild reads the frozen boundaries and records which definition it used.
- Regression test: on frozen input, live numbers reproduce exactly.

**Stage 2 — Gate labelling, no schema change.**
- `evaluateSetup()` in `src/lib/scanner/profile.ts` returns `{ stage, gates[], features, proposedProfile | null }`; `buildTradeProfile()` becomes an adapter returning `proposedProfile` only when all gates pass.
- V1 `model_observations.reason` carries the real terminal stage; `profile` carries proposed geometry for rejections.
- Fixture regression proves publication output unchanged.

**Stage 3 — Candidate capture (dark).**
- `research_candidates` table: one row per `(run_id, instrument, direction, strategy_version)`, with terminal stage, gate outcomes, deterministic features, proposed geometry, `manifest_hash`, `code_hash`. Service-role writes; RLS on with no anon/authenticated policies; admin reads via a `SECURITY DEFINER` RPC guarded by `is_admin()`.
- Best-effort write inside the existing pipeline, behind `candidate_capture_enabled`.
- Observe the funnel for at least one week before Stage 4.

**Stage 4 — Candidate forward-testing (dark).**
- `shadow_executions.cohort text NOT NULL DEFAULT 'production'` + CHECK + partial index; backfill existing 341 rows.
- Gate `create_replay_v2_sibling` on `cohort = 'production'`.
- Production reads move to a cohort-scoped view; `cohort` added to `regime_stats`/`payoff_stats` keys with a paired down-migration.
- Bounded candidate resolve budget, separate from both existing budgets, behind `candidate_enrolment_enabled`.

**Stage 5 — Filter lift reporting (admin only).**
- `recompute_filter_lift`: per-gate mean-R difference between pass and fail cohorts, with n, coverage, clustered SE by instrument-day, and a `descriptive` / `insufficient_sample` / `insufficient_coverage` status. Reported as observational, never as causal.

**Out of scope (separate plans):** `k_fill`/`k_win` and empirical-Bayes shrinkage; grade-level tiers; any change to grading, alert fan-out, the daily cap, or trader-facing wording.

## E. New acceptance criteria

1. Publication output byte-identical on recorded candle fixtures before and after Stage 2.
2. Every V1 no-trade observation carries exactly one terminal stage from a closed enum; no row keeps the generic string.
3. Inserting a `cohort='research_candidate'` row changes zero values in `regime_stats` and `payoff_stats` (CI-enforced).
4. With `replay_v2_shadow_enabled = true`, one production insert yields exactly one V2 sibling and one candidate insert yields none.
5. `shadow_executions.cohort` is `NOT NULL` for all rows after backfill, and no code path infers cohort from `signal_id`.
6. Zero candidate rows reachable via anon, authenticated, MCP tools, feed, email, push, webhook or journal.
7. MetaApi calls per resolve run unchanged (one M15 fetch per instrument).
8. `regime_stats` reproduces p_fill 0.281437 / p_win 0.510638 and `payoff_stats` -0.028590 / -0.091408 on the frozen pre-change cohort.
9. Every kill switch off restores current behaviour within one cycle, with no data dropped.

## F. Remaining risks

Gate correlation makes per-gate lift non-identifiable in the strict sense. Rejected structures may fill at a systematically different rate, which biases naive comparisons (and is itself a reportable finding). Candidate volume could exceed the CPU envelope before it is measured — mitigated only by the budget and the capture-only stage. Frozen volatility boundaries mean older rows stay classified under the definition current when they resolved; the rebuild must record the definition rather than pretend one exists globally.

## G. Confidence

High on Stage 1, 2 and 3 (mechanical, dark, fixture-verifiable, one provably reversible schema addition). Medium on Stage 4 (isolation is enforceable but touches tables that feed trader-visible priors; the CI contamination test is the load-bearing safeguard). Low-to-medium on Stage 5's interpretability — the machinery will be correct, the causal reading will not be.

## H. What still cannot be guaranteed

That measured gate lift is causal. That candidate fills are broker-realistic beyond what M15 OHLC supports — intrabar path is unknown and ambiguity flags remain the only honest signal. Any timeline to statistical maturity, because fill rate and not calendar time controls it. That a future rebuild reproduces historical tier-3 buckets exactly for rows resolved before boundary freezing.
