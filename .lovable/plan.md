# Prompt 7F — Final Closure Patch

Scope is closure only: the three blocking gaps, the filter-lift provenance pin, and the evidence run. No redesign, no Prompt 8/9 work.

## Verified current state

- `src/lib/research/` contains `candidates.server.ts`, `enrol.server.ts` (V2/V3 only), `observations.server.ts`. There is no `enrol-candidates.server.ts`, and nothing creates `cohort='research_candidate'` executions.
- `src/lib/scanner/pipeline.server.ts:460` still calls `finish("no_trade", "No structure satisfied the ABC grading rules")`, and `v1ObservationRow()` stores the job-facing text as `reason` while the structured profile already carries stage/gates/features/geometry.
- `SetupEvaluation` exposes exactly one terminal `stage` plus per-gate `detail`, so a truthful research reason is derivable without new inference.
- `src/test/fixtures/` holds only `provenance.ts` and `replay-fixtures.ts` — no frozen pre-Prompt-7 scanner copy exists.
- The shadow-resolve cron (`src/routes/api/public/cron/shadow-resolve.ts`) is the deterministic research-side runtime; the scan pipeline already runs V2/V3 dark enrolment in isolated try/catch blocks.

## 1. Stage-4 candidate enrolment runtime

New `src/lib/research/enrol-candidates.server.ts`:

- `isCandidateEnrolmentEnabled(db)` reads `shadow_engine_state.candidate_enrolment_enabled`, failing closed on any error. The switch stays **false**; no migration flips it.
- `enrolPendingCandidates(db, budget)` selects `research_candidates` rows with `enrolled_plan_id IS NULL`, `gates_complete = true`, no `not_evaluable` gate, and a complete executable profile (entry, stop, risk > 0, tp1..tp3, R values, grade, ATR all present). Anything incomplete is skipped forever — no geometry is ever synthesised.
- Insert into `shadow_executions` with `cohort='research_candidate'`, `research_candidate_id`, `replay_version = 1`, explicit `execution_policy='legacy_best_target_touched'`, `status='pending'`, `replay_cursor = detected_at`, and the candidate's own `model_version`, `strategy_version`/`manifest_hash` provenance, session and volatility index. `signal_id` stays NULL.
- Idempotency: a candidate-namespaced claim (its own key space, never the V2/V3 `claim_v2_structure` namespace) plus a conditional `UPDATE research_candidates SET enrolled_plan_id, enrolled_at WHERE id = … AND enrolled_plan_id IS NULL`, written only after the execution row exists. Duplicate-key inserts are treated as already-enrolled, not failure.
- Never throws: failures record durable health via `noteResearchFailure` and return counts.

Runtime path: called from the shadow-resolve cron handler, in its own try/catch, after production resolution and before stats recompute, bounded by `shadow_engine_state.candidate_rows_per_run`. With the switch false it performs exactly one cheap flag read and returns zero.

## 2. Truthful V1 research reason

Keep the trader/job-facing `finish()` text byte-identical. `v1ObservationRow()` gains a research reason derived from the evaluation: the exact `stage` enum value plus the failing gate's `detail` (e.g. `risk_too_wide: risk 1.9 ATR exceeds the 1.5 ATR ceiling`), and `published` for publications. No new stage names.

## 3. Blocking tests

Frozen baseline: vendor the pre-Prompt-7 scanner modules from `ab44ff687df4892745a47ffa1f3b737f04b478e0` (read-only `git show`) into `src/test/fixtures/pre-p7/` with a provenance header naming the SHA, excluded from the app graph. Characterization test drives the frozen implementation and current `evaluateSetup()` over recorded candle fixtures and asserts exact equality on publish/no-trade, direction, grade, entry, stop, TP1/TP2/TP3, TP R values, max R, confidence and components, and structure key. Two wrappers over current code is not acceptable.

Unit/integration tests: terminal-stage persistence; no fabricated geometry on rejections; candidate enrolment idempotency; candidate → execution provenance; execution policy exactly `legacy_best_target_touched`; candidate backlog cannot consume production resolver capacity; zero incremental MetaApi fetches for candidate replay (spy-counted); both switches fail closed; capture/enrolment failure cannot fail a scan job or the production resolve pass.

DB tests: NULL-direction retry idempotency; production Replay-V1 yields exactly one Replay-V2 sibling and a research candidate yields zero; a synthetic candidate row changes zero regime, payoff, weekly and MCP production values; RLS/RPC denial for anon and ordinary authenticated readers on `research_candidates`, candidate executions and `filter_lift_stats`.

## 4. Filter-lift provenance pin

Migration replacing `recompute_filter_lift()` so the candidate execution join also requires `execution_policy = 'legacy_best_target_touched'`, keeping replay identity the approved `(replay_version, execution_policy)` tuple. No other logic change.

## 5. Closure evidence

Report: commit SHA; files added/changed; migrations; `bun run verify` output; test and DB-test counts with pass/fail; characterization fixture count and exact-equality result; actual values of `candidate_capture_enabled`, `candidate_enrolment_enabled`, `candidate_rows_per_run` (read, never flipped); production vs candidate execution counts; sibling isolation result; zero-extra-MetaApi result; RLS denial result; regime/payoff before-vs-after contamination result; and every skipped or unverified item. Prompt 7 is not called closed if any blocking test is absent, skipped or failing.
