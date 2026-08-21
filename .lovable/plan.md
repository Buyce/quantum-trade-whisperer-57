# Prompt 7 Completion Pass — no redesign, close the gaps

Every gap named in the audit was re-verified against HEAD and the live database before writing this. The approved Prompt-7 architecture is kept as-is; this pass finishes it.

## Verified current state

- `src/lib/scanner/pipeline.server.ts:457` still returns the generic `"No structure satisfied the ABC grading rules"` for every rejection, and `v1ObservationRow()` (`src/lib/research/observations.server.ts:276`) hardcodes `profile: null` with no stage, gates or features.
- `research_candidates_identity` is `UNIQUE (run_id, instrument, direction, strategy_version) WHERE run_id IS NOT NULL AND direction IS NOT NULL` — NULL-direction rejections can be captured twice on retry.
- `loadOpenRows()` in `src/lib/execution/shadow_resolve.server.ts` filters `replay_version` and `model_version` but **not** `cohort`, and `MAX_ROWS_PER_RUN = 200` is shared. Once candidates enrol they would displace production rows.
- `weekly.server.ts` has a production-cohort comment but no cohort predicate (and a duplicated `.eq("replay_version")`); `user-audit.functions.ts` and `signal-audit.functions.ts` filter `replay_version = 1` only. `recompute_regime_stats` filters `cohort = 'production'` inline; `recompute_payoff_stats` reads `shadow_executions_production`.
- Stage 4 runtime enrolment does not exist. No `filter_lift_stats` / `recompute_filter_lift`. No Replay-V2 sibling isolation test.

## Work items

**1. Real V1 observation semantics.** Thread the `SetupEvaluation` from `evaluateSetup()` through to `finish()` and into `v1ObservationRow()`. The ledger reason becomes the actual terminal stage from the existing enum (`no_candles`, `m15_neutral`, `no_grade`, `no_abc`, `risk_undefined`, `risk_too_wide`, `no_headroom`, `unreachable_r`, `published`) plus its gate detail — exact enum values only, no new names. `profile` carries the structured gates, features and any geometry that was genuinely derived; it stays NULL when nothing coherent exists. No fabricated entry, stop or targets anywhere.

**2. Genuine pre-P7 characterization test.** Extract the pre-Prompt-7 scanner modules from `ab44ff687df4892745a47ffa1f3b737f04b478e0` (read-only `git show`) into a frozen, test-only vendored copy under `src/test/fixtures/pre-p7/`. Drive both the frozen implementation and current `evaluateSetup()`/`buildTradeProfile()` over recorded candle fixtures and assert byte-equality on: publish/no-trade, direction, grade, entry, stop, TP1/TP2/TP3, TP R values, max R, confidence and each component, structure key, and every other persisted scanner field. Blocking. Current V1 behaviour is not touched to make it pass — any difference is reported, not patched away.

**3. NULL-direction idempotency.** Replace the partial unique index with one over `(run_id, instrument, coalesce(direction, '∅'), strategy_version)` — a sentinel in the index expression only; no direction is ever invented in a column. Blocking DB regression: capturing the same NULL-direction evaluation twice leaves one row.

**4. The production view becomes the boundary.** Every production aggregate reads `shadow_executions_production`: `recompute_regime_stats`, `recompute_payoff_stats`, the weekly report loader, user audit, signal audit, and the MCP shadow/performance/intelligence paths. Model, replay-version and execution-policy predicates stay where independently required. Remove the duplicated `replay_version` filter. Regression: insert a synthetic `cohort='research_candidate'` row and prove regime, payoff, weekly and MCP outputs are numerically identical.

**5. Stage 4 enrolment — implemented, left dark.** New `src/lib/research/enrol-candidates.server.ts`: enrol only candidates with a complete, pre-specified executable profile; a `not_evaluable` gate or absent geometry can never become a trade. Behind `candidate_enrolment_enabled` (stays **false**), idempotent, inserts `cohort='research_candidate'` with `research_candidate_id`, strategy version and manifest hash, Replay-V1 semantics, and sets `enrolled_plan_id`/`enrolled_at` only after the insert succeeds. Claims use a candidate-specific namespace so V2/V3 claims are never consumed.

**6. Separate candidate resolver budget.** `loadOpenRows()` gains an explicit `cohort = 'production'` filter. A third pass loads candidate rows under `shadow_engine_state.candidate_rows_per_run`, after production and after Replay-V2, so production capacity is mathematically undisplaceable. No candidate-specific MetaApi fetch: candidates replay only the immutable M15 array already fetched for that instrument in the production pass; with no such fetch they stay in backlog and that fact is surfaced in the resolve summary and health telemetry.

**7. Replay-V2 sibling isolation test.** With `replay_v2_shadow_enabled = true`: one production Replay-V1 plan yields exactly one sibling; one `research_candidate` plan yields zero. Blocking.

**8. Stage 5 plumbing, no maturity claim.** `filter_lift_stats` table plus `recompute_filter_lift(...)`: reads only `research_candidate` executions, joins durably to the originating candidate and its gate outcomes, compares only within one manifest hash, excludes `not_evaluable` from that gate's pass/fail split, uses mature resolved observations with the approved per-plan payoff convention (never-filled and gap-beyond-stop = 0R), reports `n` and replay coverage, applies instrument-day dependence handling, and labels every row descriptive or insufficient. No causal or "significant" wording, ever; it never removes a gate or touches grading. Returning `unavailable` today is the correct output. Admin-only panel wording states plainly that Stage 4 is off.

**9 & 10. Security and production behaviour.** Research candidates, candidate executions and filter-lift results stay service-role/admin only — no anon or ordinary authenticated reads, and nothing in feed, alerts, email, push, webhooks, journal or ordinary MCP tools. RLS and RPC grants asserted in DB tests. Zero change to grades, direction, entry, stop, targets, max R, confidence, publication count, structure cooldown, delivery channels, feed ordering, or MetaApi call count.

**11. Blocking tests.** All fifteen listed in the prompt, including: capture failure cannot fail a scan job; enrolment failure cannot leave candidate or published state inconsistent; both kill switches fail closed; candidate forward-testing causes zero incremental MetaApi calls (spy-counted).

## Sequence

1. Item 4 isolation + item 6 production-cohort filter and budget split (protects production first).
2. Item 1 observation semantics, item 3 index migration.
3. Item 2 characterization harness (blocking gate before any further change ships).
4. Item 5 enrolment code, dark. Item 7 sibling test.
5. Item 8 filter-lift plumbing and admin panel.
6. Full `bun run verify` plus the DB regression project.

## Technical notes

- Pre-P7 sources are vendored under a test-only path, excluded from the app graph, with a provenance header naming the SHA — so the baseline cannot drift with HEAD.
- The index change is expressed as `coalesce(direction, '∅')` inside the unique index; the column stays nullable and untouched.
- Candidate resolution reuses `replaySetup` unchanged; there is no candidate-specific replay code path and no new provider contract.
- `ResolveSummary` gains `candidateScanned` / `candidateAdvanced` / `candidateBacklogNoCandles` so a starved backlog is visible rather than silent.

## Evidence returned on completion

Commit SHAs; migrations added; full `bun run verify` output; blocking and DB regression counts; pre/post characterization fixture results; candidate count and counts by terminal stage; NULL-direction duplicate result; production vs candidate shadow row counts; actual values of `candidate_capture_enabled`, `candidate_enrolment_enabled`, `candidate_rows_per_run` (reported, never silently flipped); production resolver capacity test; MetaApi calls per resolve before and after; RLS denial tests; regime and payoff baselines before and after; and every deviation, skipped test or unverified claim.
