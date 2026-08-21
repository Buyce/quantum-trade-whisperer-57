# Prompt 7G — red-team review of my own remediation plan, plus revised plan

I re-read HEAD (profile.ts, counterfactual-plan.ts, candidates.server.ts, enrol-candidates.server.ts, the 20260821175102 migration, the deployed `recompute_filter_lift`, `get_admin_candidate_funnel`, `create_replay_v2_sibling`, the enrolment and DB tests, CandidatePanel). The previous plan survives on the two mechanical defects but contains one **statistically fatal** flaw and two engineering errors.

## A. Plan defects discovered

**A1 (fatal, invalidates the experiment). Grouping filter lift by `plan_origin` makes the pass and fail arms non-comparable — permanently.**
For gate G, the fail arm is by construction almost entirely `plan_origin='counterfactual'` (a rejected setup can only have the frozen 1R/2R/3R ladder), while the pass arm is `plan_origin='production'` (published plan: real TP ladder, real max-R, headroom-conditioned). Grouping by origin therefore puts the two arms in **different rows that must never be subtracted**. My previous plan even reinforced this by adding `research_plan_version` to the key. The result: a populated fail arm with nothing legitimate to compare it against. That is not filter lift; it is two unrelated numbers side by side.
The confound is not incidental: the pass arm's ladder was *selected by the very filters under test* (headroom, reachable-R). Comparing it with an unconditional 3R ladder measures the ladder, not the filter. This is textbook selection bias re-entering through the execution policy.

**A2. Unique-index mechanics were wrong.** I wrote "`create unique index concurrently`-safe". `CONCURRENTLY` cannot run inside the transaction Supabase migrations use. Also, `(research_candidate_id, replay_version, execution_policy)` as the identity **blocks A1's fix**: if one candidate must carry both a production-plan execution and a counterfactual-ladder execution, that tuple collides.

**A3. Fail-closed hole in the whitelist.** Keying executability off `counterfactual_class` alone lets legacy rows (column NULL, captured before 7G) be judged by an ambiguous value, and lets a *future* stage added to `COUNTERFACTUAL_STAGES` silently become executable. Duplicated business logic: the "which stages are executable" rule then lives in profile.ts, in the DB CHECK, and implicitly in the enroller.

**A4. `research_plan_version` in the filter-lift PK is the wrong lever.** With A1 fixed (one common research policy per arm), version pinning belongs in a *guard* — refuse to pool two ladder versions — not in the grouping key, which would fragment arms.

**A5. My E2E design risks fixture overfitting.** Hand-shaping candles until `evaluateSetup` returns `risk_too_wide` is fixture tuning. Acceptable only if the test asserts the stage/geometry purely from the evaluator's output and the ladder is recomputed independently in the assertion, never copied from the implementation.

## B. Each major decision: why, alternatives, rejection, evidence, what would change my mind

**B1. Execution policy for arm comparison → "common research ladder on BOTH arms" (changed from my previous plan).**
Every candidate whose geometry is complete — *published or filter-rejected* — gets a research-only counterfactual execution under the identical frozen ladder. Filter lift then compares like with like, and `plan_origin` becomes a reported attribute, not a grouping key.
- *Alt 1: origin-split grouping (my previous plan).* Rejected: A1 — the arms can never be compared, so the experiment stays unfinished while looking finished.
- *Alt 2: give the fail arm the production-style ladder by re-deriving TPs from structure.* Rejected: re-running structure/headroom logic on a setup those filters rejected either reproduces the rejection or requires inventing structure that was never derived — lookahead-adjacent and it changes V1 geometry semantics.
- *Evidence:* `recompute_filter_lift` already keys on `(replay_version, execution_policy)` precisely to prevent pooling different execution semantics; the same principle forbids pooling different *plan* semantics across arms. The counterfactual ladder is deliberately unconditional (counterfactual-plan.ts docblock) exactly so it is filter-independent — that property is only useful if both arms use it.
- *Would change my mind:* if a published candidate's production execution could be shown to have identical target semantics to the ladder (it cannot: `max_r` is headroom-derived).

**B2. Idempotency identity → partial unique index including the plan lineage.**
`unique (research_candidate_id, replay_version, execution_policy, plan_origin) where research_candidate_id is not null`, with `plan_origin` added to `shadow_executions` (nullable, defaulted from the candidate at insert). One candidate ⇒ at most one production-plan candidate execution and at most one counterfactual-ladder execution. Plain `CREATE UNIQUE INDEX` (no CONCURRENTLY); a pre-flight `DO` block raises if duplicates already exist.
- *Alt 1: single-tuple index without `plan_origin`.* Rejected: blocks B1.
- *Alt 2: one `security definer` RPC doing insert + bookkeeping in a single transaction.* Genuinely stronger (no orphan window at all) but duplicates enrolment business logic in SQL where it can drift from the TS module; the index plus conflict-reconciliation makes the orphan self-healing, which is sufficient. Revisit if enrolment ever goes live at volume.
- *Reconciliation:* insert with `ignoreDuplicates` on that conflict target; on conflict, read the existing row's `plan_id` and write it to `enrolled_plan_id` guarded by `is null`. Idempotency never depends on `plan_id` randomness or the 120-minute claim (claim demoted to a rate limiter).

**B3. Executability rule → explicit, fail-closed, single-sourced.**
Executable iff: `gates_complete`, exactly one `fail` gate and that gate is in the frozen stage whitelist, `counterfactual_class = 'executable'`, `plan_origin` is non-null, `research_plan_version` equals the current constant, and every geometry/ladder field is non-null with `risk > 0`. NULL/unknown ⇒ not executable, forever.
- *Alt 1: drop the `not_evaluable` check.* Rejected: it would admit `no_grade` / `risk_undefined` rows the moment any geometry column is partially populated.
- *Alt 2: DB-side `is_executable_candidate()` generated column.* Rejected for now: third copy of the rule; the TS enroller is the only writer.

**B4. Uncertainty → `se_r = NULL` for research rows.** `sd_r/sqrt(cluster_n)` is neither i.i.d. nor cluster-robust. Alternatives (keep and rename; implement cluster bootstrap now) rejected: false precision, and Prompt 8 owns dependence-aware uncertainty. `stat_status` caps at `descriptive`; `reason` says uncertainty is unsupported.

## C. Failure scenarios the architecture must survive

1. **Worker dies between insert and bookkeeping** (serverless lifecycle). Retry after the claim window: unique violation ⇒ reconcile ⇒ exactly one execution, `enrolled_plan_id` set. No orphan.
2. **Two concurrent shadow-resolve crons pick the same candidate** (claim expired / clock skew). Both insert; one wins, the loser reconciles to the winner's `plan_id`. Filter lift counts one row.
3. **Migration meets pre-existing duplicates** (index creation would fail mid-migration). Pre-flight raise aborts the migration cleanly; forward fix = keep the earliest execution per identity, then re-run. No data destroyed.
4. **Capture ladder version bumped later.** The enroller refuses rows whose `research_plan_version` ≠ current; `recompute_filter_lift` raises if more than one version is present in the source set, rather than silently pooling.
5. **Research write path fails entirely** (timeout/partial write). Existing never-throws contract holds: `research_errors` increments, production resolve pass is not re-labelled, no writes to `scanned_signals` / `market_context` / `executed_trades`.

## D. Revised plan (supersedes the previous one)

**D1. Backend — `enrol-candidates.server.ts`**: implement B3's whitelist; select `counterfactual_class`, `research_plan_version`, `plan_origin`; conflict-tolerant insert + reconciliation (B2); stamp `plan_origin` on the execution; keep cohort `research_candidate`, Replay-V1, `legacy_best_target_touched`, `research_candidate_id`, candidate provenance, budget, kill switch, never-throws.

**D2. Capture — `candidates.server.ts` + `counterfactual-plan.ts`**: also build the counterfactual ladder for **published** candidates, stored in new dedicated columns (`cf_tp1..cf_tp3`, `cf_tp1_r..cf_tp3_r`, `cf_max_r`, `cf_plan_version`) so a published row keeps its production plan untouched *and* carries a research plan. `plan_origin` remains the description of the production side. V1 publication behaviour byte-identical (characterization suite is the gate).

**D3. Migration (single, reversible)**:
- `shadow_executions`: add `plan_origin text` + CHECK in (`production`,`counterfactual`).
- pre-flight duplicate raise, then `CREATE UNIQUE INDEX shadow_executions_research_identity ON shadow_executions (research_candidate_id, replay_version, execution_policy, plan_origin) WHERE research_candidate_id IS NOT NULL`.
- `research_candidates`: add the `cf_*` ladder columns; keep the existing counterfactual CHECK.
- `recompute_filter_lift()`: **remove `plan_origin` from the grouping key**; restrict the source join to counterfactual-ladder executions only (`plan_origin='counterfactual'`); raise/refuse if more than one `research_plan_version` appears; `se_r = NULL`; report `research_plan_version` and `policy = 'common_counterfactual_ladder_v1'` in the result JSON; PK back to `(manifest_hash, gate, arm)`.
- `get_admin_candidate_funnel()`: keep the origin split, add counterfactual-ladder coverage (how many executable candidates have a research execution).

**D4. Frontend**: `CandidatePanel` labels the fail/pass arms as "common research ladder v1", shows ladder coverage, and shows uncertainty as "unsupported (Prompt 8)". No trader-facing surface changes.

**D5. Tests (all blocking)**
- **E2E, real candles**: fixture → `evaluateSetup` asserts stage `risk_too_wide` and non-null derived geometry → `captureCandidate` payload → DB row → `enrolPendingCandidates` → exactly one execution (cohort/replay/policy/`plan_origin='counterfactual'`/`research_candidate_id`) → resolve to a known R → `recompute_filter_lift` shows the gate's **fail arm `n_used = 1`** with the hand-computed `mean_r`, and a passed-gate arm populated from a published candidate's counterfactual sibling. Ladder expectations recomputed in the test (long 1.10000/1.09000 → 1.11/1.12/1.13; short 1954/1960 → 1948/1942/1936).
- **Structurally undefined**: `no_candles`, `m15_neutral`, `no_grade`, `risk_undefined` fixtures ⇒ ladder NULL, `plan_origin` NULL, never executable.
- **Atomic idempotency (DB)**: insert succeeds, bookkeeping fails, retry after the claim window ⇒ exactly one execution, bookkeeping reconciles to it.
- **Concurrency**: two enrollers, same candidate ⇒ one execution.
- **Version guard**: mixed `research_plan_version` ⇒ filter lift refuses rather than pools.
- **Isolation (DB)**: candidate rows change zero regime/payoff/weekly/production-view/intelligence values; zero Replay-V2 siblings.
- **Characterization**: the 111 `ab44ff6` publish/no-trade assertions unchanged.
- **RLS**: anon and ordinary authenticated denied on `research_candidates` and `filter_lift_stats`.

**D6. Non-effects (asserted, not assumed)**: no change to signal count, grades, entries, stops, production targets, fills, expectancy, alerts, webhooks, MCP tools or risk-calculator output; no extra MetaApi calls (resolution replays already-fetched per-instrument candle batches); both dark switches remain FALSE.

## E. New acceptance criteria
`bun run verify` green including the new E2E, concurrency, version-guard and DB tests; fail arm and pass arm both populated **under one common research ladder**; one structurally-undefined rejection proven non-executable; duplicate/failed-bookkeeping retry proven to leave exactly one execution; `se_r` NULL for research rows; `candidate_capture_enabled` and `candidate_enrolment_enabled` still FALSE; characterization unchanged.

## F. Remaining risks
- The common ladder is a **trading hypothesis**, not a validated policy: it ignores spread, slippage and session liquidity, and its 3R cap can truncate winners on both arms equally (bias in level, not in comparison).
- Arms remain confounded by *downstream* gates: a gate's pass arm contains setups that later failed other gates. Only stratified/sequential analysis fixes that — Prompt 8 territory; the reason string must say so.
- Overlapping plans are not independent; no valid interval exists yet.
- No historical counterfactual data exists (capture is dark), so no numeric baseline can be computed now — it will be captured after the flip, never fabricated.

## G. Confidence
High (mechanical defects: the `not_evaluable` guard and the missing per-candidate unique index are directly readable in HEAD). Medium-high on the common-ladder redesign: it is the only way I can see to make the arms comparable without touching V1, but it enlarges capture to published rows, so the characterization suite and the DB isolation tests are the real gate.

## H. What cannot be guaranteed
That measured filter lift transfers to live execution; that a 1R/2R/3R ladder is the *right* research policy; safety against manual SQL that bypasses the enroller; that Prompt 8's uncertainty work will validate any lift observed here.

**Recommendation: adopt the revised plan (common research ladder + `plan_origin`-aware unique index + fail-closed whitelist + NULL research `se_r`). Reject my earlier origin-split grouping.**
