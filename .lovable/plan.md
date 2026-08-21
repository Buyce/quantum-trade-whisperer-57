# Prompt 7G — end-to-end candidate experiment closure

## 1. Goal
Make the *rejected-filter* arm of the research engine genuinely forward-testable end to end, and make candidate enrolment atomically idempotent — without changing V1 publication behaviour, without inventing geometry, and without claiming statistical rigour that Prompt 8 owns.

## 2. Current implementation (re-read at HEAD)
- `evaluateSetup()` (src/lib/scanner/profile.ts) now labels every evaluation `counterfactual: "executable" | "structurally_not_evaluable"`; only `risk_too_wide`, `no_headroom`, `unreachable_r` (with derived direction/entry/stop/positive risk/ATR) are executable.
- `buildCounterfactualPlan()` (src/lib/research/counterfactual-plan.ts) emits a version-pinned unconditional 1R/2R/3R ladder, `RESEARCH_PLAN_VERSION = 1`.
- `captureCandidate()` writes `plan_origin`, `counterfactual_stage`, `research_plan_version`, `counterfactual_class`, ladder columns; DB CHECK forbids a counterfactual plan without real geometry.
- `recompute_filter_lift()` groups by `manifest_hash | gate | arm | plan_origin`, joined only to cohort `research_candidate`, replay 1, `legacy_best_target_touched`, and only on gate outcomes `pass`/`fail`.
- Both dark switches (`candidate_capture_enabled`, `candidate_enrolment_enabled`) are FALSE.

## 3. Confirmed defects
**D1 — the fail arm is still unreachable (blocking).** `isExecutableCandidate()` (src/lib/research/enrol-candidates.server.ts:137) rejects any candidate whose gate list contains `not_evaluable`. Every filter rejection terminates early, and `terminate()` pads all later gates as `not_evaluable` by construction. So *every* counterfactual candidate is skipped and `filter_lift_stats` fail arms stay `n_used = 0`. The Item-1 work is inert in production terms.

**D2 — enrolment is not atomically idempotent (blocking).** The only relevant unique index is `shadow_executions_plan_replay_policy_key` on `(plan_id, replay_version, execution_policy)`; `plan_id` is a fresh `crypto.randomUUID()` per attempt. If the execution insert succeeds and the `enrolled_plan_id` bookkeeping update fails, the candidate stays unenrolled and a retry after the 120-minute claim window inserts a *second* execution for the same candidate — double-counted in filter lift.

**D3 — `se_r` is presented as if it were uncertainty.** `sd_r / sqrt(cluster_n)` mixes a per-observation SD with a cluster count; it is neither an i.i.d. SE nor a cluster-robust SE, yet rows reach `stat_status = 'descriptive'` carrying it.

**D4 — no true end-to-end test.** Existing tests cover classification, ladder maths, capture payload and (synthetic-row) DB isolation. Nothing runs real candles → `evaluateSetup` → `captureCandidate` → DB row → `enrolPendingCandidates` → `shadow_executions` → `recompute_filter_lift`.

**D5 — counterfactual policy version is not in the filter-lift grouping key.** `plan_origin` alone would pool ladder v1 with a future ladder v2.

## 4. Secondary risks found
- `gates_complete` is `gates.length === 8`, which is true for rejections; correct, but it means "complete gate list", not "all passed" — the fix must not lean on it as an executability signal.
- Relaxing the `not_evaluable` guard naively would let `no_grade` / `risk_undefined` rows through if their geometry were ever partially populated. The guard must be replaced by an explicit *whitelist*, not deleted.
- `research_candidates_identity` (unique on run/observation/coalesce(direction)) protects capture retries, not enrolment.
- Filter lift `DELETE FROM filter_lift_stats` then re-insert inside one advisory-locked transaction: acceptable, unchanged.
- No trader-visible surface reads `research_candidates`, `filter_lift_stats`, or candidate-cohort executions (production view excludes them) — so none of this can move signals, grades, fills, alerts, expectancy or MCP output. MetaApi is untouched.

## 5. Alternatives considered

**D1 fix**
- *(A) Whitelist on `counterfactual_class` + `plan_origin`.* Executability = `plan_origin='production'` (existing rules, incl. no `not_evaluable`) OR (`plan_origin='counterfactual'` AND `counterfactual_class='executable'` AND exactly one `fail` gate AND full ladder/geometry non-null AND risk>0). Small, explicit, fail-closed, keeps production semantics byte-identical. **Recommended.**
- *(B) Stop padding `not_evaluable` gates for filter rejections.* Rejected: mutates `SetupEvaluation` shape that characterization tests and `model_observations.reason` depend on, and destroys the "which gates were actually evaluated" information filter lift needs.

**D2 fix**
- *(A) Partial unique index* `unique (research_candidate_id, replay_version, execution_policy) where research_candidate_id is not null`, plus reconciliation: on a unique violation the enroller **reads the existing execution's `plan_id`** and writes it into `enrolled_plan_id` (still `is null` guarded). Idempotency lives in the database; the claim becomes a pure rate-limiter. **Recommended.**
- *(B) A single `security definer` RPC `enrol_research_candidate(...)` doing insert + bookkeeping in one transaction.* Stronger (one round trip, no orphan window at all) but adds a second copy of enrolment business logic in SQL that can diverge from the TS module. Take (A) now; (A) already makes the orphan self-healing.

**D3 fix**
- *(A) Set `se_r = NULL` for research filter-lift rows and state "uncertainty unsupported until Prompt 8".* Fail-closed, no false precision. **Recommended.**
- *(B) Keep the number, rename the reason string.* Rejected: a numeric column named `se_r` will be read as a standard error regardless of prose.

## 6. Maths
Ladder unchanged and frozen: `risk = |entry − stop|`, `tpN = entry ± risk·N`, `N ∈ {1,2,3}`, `max_r = 3`, `research_plan_version = 1`. Worked cases for the tests: long entry 1.10000 / stop 1.09000 → risk 0.01 → TP 1.11/1.12/1.13. Short entry 1954.00 / stop 1960.00 → risk 6 → TP 1948/1942/1936. This is arithmetic on candle-derived numbers only; no future information, no consultation of the headroom/reachable-R filters under test.

## 7. Database changes (one migration)
1. `create unique index concurrently`-safe partial index `shadow_executions_research_candidate_identity` on `(research_candidate_id, replay_version, execution_policy) where research_candidate_id is not null`. Pre-flight `select` proving zero existing duplicates; the migration aborts with a raise if any exist.
2. `recompute_filter_lift()`: add `research_plan_version` to the grouping key and output JSON (new PK `(manifest_hash, gate, arm, plan_origin, research_plan_version)`), and emit `se_r = NULL` with `reason` stating cluster-robust uncertainty is unsupported until Prompt 8.
3. No writes to `scanned_signals`, `market_context`, `executed_trades`. No RLS change (research tables stay service-role only).

## 8. Backend changes
- `enrol-candidates.server.ts`: whitelist executability (D1); on insert unique-violation, reconcile `enrolled_plan_id` from the existing row instead of `continue`; keep never-throws, budget, kill switch, provenance, cohort, Replay-V1, policy.
- `filter_lift_stats` typed row + `src/lib/learning/candidates.ts` gain `research_plan_version`; `se_r` rendered as "unsupported".

## 9. Frontend / MCP
`CandidatePanel.tsx`: show `research_plan_version` next to origin and replace any SE display with "uncertainty unsupported (Prompt 8)". No MCP tool touches research tables — no change.

## 10. Test matrix (all blocking)
- **E2E (new, `research-e2e.test.ts`)**: a deterministic *candle* fixture whose `evaluateSetup()` terminal stage is asserted to be `risk_too_wide` (not a hand-written candidate row) → `captureCandidate` against the fake Supabase → payload asserted → same payload inserted into the DB-cluster test → `enrolPendingCandidates` → exactly one `shadow_executions` row with cohort/replay/policy/`research_candidate_id` → resolve it to a known R → `recompute_filter_lift()` returns a **fail-arm row with `n_used = 1`** and the expected `mean_r`.
- **Structurally undefined**: a candle fixture terminating at `no_candles` / `m15_neutral` / `no_grade` stays `plan_origin=null`, ladder NULL, and `isExecutableCandidate()` false.
- **Idempotency (DB)**: insert execution; simulate bookkeeping failure; retry outside the claim window ⇒ unique violation ⇒ total candidate executions = 1 and `enrolled_plan_id` reconciles to that execution's `plan_id`.
- **Isolation**: counterfactual candidate changes zero regime/payoff/weekly/production-view values; zero Replay-V2 siblings.
- **Characterization**: the 111 `ab44ff6` publish/no-trade assertions unchanged.
- **RLS**: anon and ordinary authenticated denied on `research_candidates`, `filter_lift_stats`.
- **Failure injection**: capture timeout, duplicate capture, concurrent enrolment of the same candidate (second attempt violates the new index), stats RPC failure not re-labelling a resolve pass.

## 11. Baseline
Production baselines (signal count, grade/instrument/session mix, fill rate, expected R) are unaffected by design; the meaningful before/after is `filter_lift_stats` fail-arm `n_used`, currently **0 by construction**. There is no historical counterfactual data in the database yet (capture is dark), so no numeric research baseline can be computed — it will be captured post-flip, not fabricated.

## 12. Rollout / rollback
Both dark switches remain FALSE after this release. Rollback = drop the new unique index and restore the prior `recompute_filter_lift()` body; no collected data is destroyed (stats are recomputed from source rows). Kill switches unchanged; no execution path touches live trading.

## 13. Acceptance criteria
`bun run verify` green including new E2E and DB tests; one real rejected candle fixture proven to reach a fail-arm filter-lift row; one structurally undefined rejection proven non-executable; duplicate-enrolment attempt proven to leave exactly one execution; `candidate_capture_enabled` and `candidate_enrolment_enabled` still FALSE.

## 14. Limits — what cannot be guaranteed
The counterfactual ladder is a **trading hypothesis under test**, not a validated policy: it says nothing about whether those rejected setups would have been profitable in live execution (slippage, spread, session liquidity are outside replay). Any fail-arm number remains a descriptive within-manifest comparison with no causal claim and no valid uncertainty until Prompt 8. Concurrency safety is guaranteed at the DB identity level, not against manual SQL that bypasses the enroller.

**Recommendation: proceed with the plan above (approach A for each defect).**
