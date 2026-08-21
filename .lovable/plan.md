# Research Engine: Removing Publication-Selection Bias from Learning

## 1. Restatement of the actual goal

Today the learning engine can only answer "how did setups that already passed every V1 gate perform?". You want it to answer "did gate X earn its place?". That requires forward-testing structurally plausible candidates that V1 *rejected*, with their rejection reason recorded, while production signals, alerts and journals stay byte-for-byte unchanged.

## 2. Current implementation discovered (verified at HEAD)

- `src/lib/scanner/pipeline.server.ts` processes one instrument per job: fetch H4/H1/M15, evaluate V2 and V3 research models, then V1 (`buildTradeProfile`), then publish.
- A research ledger already exists: `model_observations` (one row per run/instrument/model_version, unique on that triple), with `decision`, `disposition`, `reason`, `code_hash`, `latency_ms`, `profile` jsonb. V2/V3 store geometry in `profile`; V1 stores **nothing** in `profile`.
- Shadow forward-testing writes `shadow_executions`, resolved by `src/lib/execution/shadow_resolve.server.ts` — **one 1000-bar M15 fetch per instrument per run**, then pure replay over that shared array.
- `recompute_regime_stats(mv)` (Beta-Binomial, k=30) is called by `src/routes/api/public/cron/shadow-resolve.ts` pinned to `ACTIVE_MODEL_VERSION = 1`. `recompute_payoff_stats` produces the 6B expected-R cohorts.
- Research enrolment kill switches exist and are **all off**: `v2_enabled=f`, `v3_enabled=f`, `replay_v2_shadow_enabled=f`.

Measured state (facts, not estimates): `shadow_executions` = 338 rows, all `model_version=1, replay_version=1`; 334 resolved; 94 filled (p_fill 0.2814); 48 wins of 94 filled (0.5106); mean R per plan -0.0286, mean R given executable -0.0914. `model_observations` = 104 rows, all from 2026-08-21 (ledger is one day old); only 26 carry a `profile`. 182 `scanned_signals` exist.

## 3. Files / functions / tables / RPCs / components affected

Code: `scanner/pipeline.server.ts`, `scanner/profile.ts`, `scanner/grading.ts`, `scanner/types.ts`, `research/observations.server.ts`, `research/enrol.server.ts`, `execution/shadow_resolve.server.ts`, `execution/replay*.ts`, `learning/regime.ts` + `regime.server.ts`, `learning/explain.ts`, `lib/versioning.ts`, `lib/research.functions.ts`, `lib/payoff.functions.ts`, admin components (`ResearchPanel`, `PayoffPanel`, new candidate panel), `lib/mcp/*`.
DB: new `research_candidates`, new `candidate_gate_outcomes` (or gate array column), `shadow_executions` (+`cohort`), `regime_stats`/`regime_snapshots`, `payoff_stats`/`payoff_snapshots`, `recompute_regime_stats`, `recompute_payoff_stats`, `get_admin_intelligence`, `get_admin_payoff_research`, new `recompute_filter_lift`.

## 4. Confirmed defects

1. **Selection bias (the requested defect).** `recompute_regime_stats` and `recompute_payoff_stats` read only `shadow_executions`, which is only fed by published V1 signals (plus V2/V3 enrolment, currently off). Rejected structures are never forward-tested, so no filter can be evaluated.
2. **V1 rejection is unlabelled.** `buildTradeProfile` has six distinct `return null` sites (neutral M15, no grade, no ABC, empty candles, risk/reachability veto) that all collapse into one ledger string, "No structure satisfied the ABC grading rules" (24 of 24 V1 no-trade rows). The stage that rejected the setup is unrecoverable.
3. **No rejected geometry.** V1 no-trade rows carry `profile = null`, so even a labelled rejection cannot be replayed — nothing records the entry/stop/targets that *would* have been proposed.
4. **`recompute_regime_stats` has no `replay_version` filter.** It aggregates every resolved row for the model. The moment `replay_v2_shadow_enabled` is turned on, each plan contributes twice under two different exit policies. Latent today only because no V2 replay rows exist.
5. **Volatility tercile boundaries are recomputed every run** from all resolved rows, then used as the tier-3 bucket key. Bucket membership therefore drifts, and `n_total` per tier-3 bucket silently mixes rows classified under different boundaries. Tier-0 rows are snapshotted, but the aggregate is not rebuilt per definition.
6. **Single k=30 for two different denominators.** `p_fill` shrinks on `n_total`, `p_win` on `n_filled`. With `n_filled = 32` at tier 2 (EURUSD|long), the parent still carries ~48% of the weight; some tier-3 win estimates rest on 1-6 filled samples while passing the `MIN_N_TIER3` gate, which is counted on `n_total`.

## 5. Hidden / secondary risks found

- 156 of 338 `shadow_executions` rows have `signal_id IS NULL` **and** `observation_key IS NULL`, `model_version = 1`, spanning 2026-08-11..20. The FK is `NO ACTION`, so retention purge did not orphan them; their generating code path cannot be identified from the data. They are 46% of the learning cohort and must be classified (provenance query first) before any cohort is treated as "production-only".
- `enroll_shadow_signal` trigger fires on every `scanned_signals` insert; a candidate must never be written there.
- `claim_v2_structure` is a shared cooldown table keyed by `(model_version, structure_key)`. Candidates need their own model-version slot or they will steal V2/V3 cooldowns.
- Adding candidates multiplies `shadow_queue`/replay row volume; the resolve worker has fixed budgets (`MAX_ROWS_PER_RUN`, `RESEARCH_MAX_ROWS_PER_RUN = 60`) and a 2s CPU envelope.
- UI wording: the intelligence panel says priors are learned from shadow telemetry; if candidates enter the same tables that becomes false.
- MCP tools expose signals/intelligence; candidate rows must be filtered out of every tool response.

## 6. Alternative implementation approaches

**A. Candidate capture: extend `model_observations` vs a dedicated `research_candidates` table.**
Extending is cheaper (no new grants/RLS) but the table's identity is `(run_id, instrument, model_version)` — one row per model per cycle. Candidates are *many per cycle* (both directions, multiple rejection stages), so extending breaks its unique key and its meaning as a model-decision ledger. Recommend a dedicated `research_candidates` table, one row per `(run_id, instrument, direction, strategy_version)`, and keep `model_observations` as the decision ledger, joined by `observation_key`.

**B. Candidate forward-testing: reuse `shadow_executions` + `cohort` column vs a separate `candidate_executions` table.**
Reuse inherits replay, ambiguity adjudication, coverage, maturity and payoff machinery already keyed by `(plan_id, replay_version, execution_policy)`; the cost is that every existing aggregate must gain a `cohort` filter, and a missed filter contaminates live priors. A separate table avoids contamination by construction but duplicates ~800 lines of replay/payoff logic that would then drift — the exact "duplicated business logic" failure mode. Recommend reuse **with** `cohort NOT NULL DEFAULT 'production'`, plus a `CHECK` and a partial index, and make the contamination detectable: every aggregate function asserts a single cohort and stores `cohort` in its PK.

**C. Rejection labelling: refactor `buildTradeProfile` to return an evaluation object vs bolt a parallel "candidate evaluator" alongside it.**
A parallel evaluator guarantees zero risk to V1 but immediately duplicates the geometry maths, so a V1 fix would silently not reach research (and vice versa) — the same divergence that motivated V2/V3 manifests. Recommend refactoring V1 into `evaluateSetup()` returning `{ stage, gates[], features, proposedProfile|null }`, with `buildTradeProfile()` kept as a thin adapter returning `profile` only when every gate passed. Publication behaviour is then provably unchanged by a byte-for-byte regression test over recorded candle fixtures, and there is one implementation of the geometry.

**D. Versioning: single `strategy_version` vs component versions.**
Single integer is simple but any component edit either bumps everything (fragmenting cohorts) or nothing (silently pooling incompatible data). Full component versioning is precise but there is no mechanism today that *prevents* pooling. Recommend both, minimally: a `strategy_manifests` row per `(strategy_version, manifest_hash)` where `manifest_hash` is derived from the component hashes (`MODEL_V*_CODE_HASH`, replay hash, feature-extractor hash), and make `manifest_hash` part of the PK of every aggregate. Incompatible data then cannot be aggregated because it cannot share a row.

**E. Regime model: fixed hierarchy + tuned k, empirical-Bayes k, fully Bayesian, or plain shrinkage.**
Fully Bayesian (MCMC/variational) is not justifiable in a 2s Postgres/worker budget and is unverifiable by the tests we can write. Plain global shrinkage discards instrument structure we already observe. Recommend keeping the current 3-tier fixed hierarchy but: (i) separate `k_fill` and `k_win`; (ii) estimate each by method-of-moments empirical Bayes from the parent's observed over-dispersion, with a hard floor and a documented fallback to k=30 when the moment estimate is undefined (fail-closed); (iii) freeze volatility bucket boundaries as a versioned definition. Grade/strategy enters as an optional tier-2.5 (`instrument|direction|grade`) that only answers when it clears its own n floor — no new terminal tier, so tier-3 sparsity is unchanged.

**F. Replay cost.** Candidates need **no extra provider calls**: `shadow_resolve` already fetches one 1000-bar M15 series per instrument per run and replays all rows against that array. Cost is CPU and row budget only, so candidates get their own bounded budget rather than a new fetch path.

## 7. Recommended architecture

`evaluateSetup()` (one geometry implementation, gate-labelled) → `research_candidates` row per direction per cycle with deterministic features + gate outcomes + proposed geometry → optional bounded enrolment into `shadow_executions` with `cohort='research_candidate'` → replay unchanged → `recompute_*` functions cohort-scoped and manifest-keyed → new `recompute_filter_lift` comparing per-gate pass/fail cohorts on mean R per plan → admin-only UI. Production path, alerts, push, email, webhook, journal and MCP see nothing new.

## 8. Mathematical / statistical derivation

- Shrinkage as implemented: `p̂ = (x + k·p_parent)/(n + k)`, verified against live rows (EURUSD|long fill `(32 + 30·0.281437)/(97+30) = 0.3185`; win `(25 + 30·0.510638)/(32+30) = 0.6503`). Hierarchy is coherent: tier2 shrinks to tier1 raw, tier3 to tier2 shrunk.
- Empirical-Bayes k (method of moments): for sibling buckets with counts `n_i`, successes `x_i`, estimate parent mean `μ` and between-bucket variance `σ²`; `k = μ(1-μ)/σ² - 1`, clamped to `[5, 200]`, undefined (`σ² ≤ μ(1-μ)/(1+200)`) → report `k_source='fallback'` and keep 30.
- Filter lift for gate g: `Δ_g = E[R_perplan | g passed] - E[R_perplan | g failed]`, both estimated on the candidate cohort only, unfilled and gap-beyond-stop = 0R (6B convention). Report SE clustered by `(instrument, UTC day)` because overlapping plans are not independent; status `descriptive` only, never `significant`.
- Honest limitation: this is observational, not randomised. Gates are correlated (a setup failing the ABC gate is never scored for headroom), so `Δ_g` is confounded and must be labelled a **trading hypothesis to be tested**, not proof.

## 9. Database changes

1. `research_candidates` — `id`, `run_id`, `observation_key`, `strategy_version`, `manifest_hash`, `detected_at`, `instrument`, `direction`, `session`, features (ABC geometry: A/B/C prices + times, retracement, symmetry; trend: H4/H1/M15 bias + alignment score; zone: order-block flag/distance; momentum score; volatility: M15 ATR, H1 ATR, vol index; headroom ATR; barrier price/source), proposed `entry_price`/`stop_loss`/`tp1..3` + R multiples + `max_r`, `terminal_stage`, `published boolean`, `signal_id` nullable, `suppression_reason`. No triggers. RLS enabled, no anon/authenticated grants (service-role + admin RPC only).
2. `candidate_gate_outcomes` — `(candidate_id, gate_key, passed, detail)`; enables per-gate lift without a jsonb scan.
3. `shadow_executions.cohort text NOT NULL DEFAULT 'production'` + CHECK + index; backfill existing rows to `'production'` after the provenance question in §5 is answered.
4. `strategy_manifests` — `(strategy_version, manifest_hash)` PK, component hashes, registered_at.
5. `regime_stats`, `regime_snapshots`, `payoff_stats`, `payoff_snapshots`: add `cohort` (+ `manifest_hash` where absent) to PK; `recompute_regime_stats` gains `replay_version` and `cohort` filters (defect 4) and versioned vol boundaries (defect 5); k becomes `k_fill`/`k_win` with `k_source` recorded.
6. New `recompute_filter_lift(...)` writing `filter_lift_stats` with the same maturity/coverage/status vocabulary as 6B.

## 10. Backend changes

`evaluateSetup()` refactor + adapter; `recordCandidate()` bounded and swallowing exactly like `recordObservations`; `enrolCandidateShadow()` behind a new `candidate_enrolment_enabled` switch and its own model-version cooldown slot; separate `CANDIDATE_MAX_ROWS_PER_RUN` budget in `shadow_resolve`; admin server functions for candidate coverage, gate lift and recompute.

## 11. Frontend changes

Admin-only: candidate funnel panel (per-stage rejection counts), gate-lift table with n/coverage/status and an explicit "observational, confounded" caption. Trader-facing UI untouched. Any copy claiming priors come from published signals is corrected once candidates enter a cohort.

## 12. MCP / API implications

All MCP tools stay production-scoped; each candidate-touching query gets an explicit `cohort='production'` predicate, with a test asserting `list_signals`, `get_intelligence`, `get_performance_summary` and `get_shadow_comparison` return zero candidate rows. No new public routes; recompute runs from the existing authenticated cron route.

## 13. Historical-data / versioning implications

No historical row is rewritten. Existing 338 shadow rows become `cohort='production'`; existing `regime_stats` is rebuilt (it is derived, and `regime_snapshots` preserves history). Candidate cohorts start empty and accumulate forward only — no backfill of rejected candidates is possible, because their geometry was never recorded. First lift readouts are weeks away; we will not fabricate them.

## 14. Security implications

New tables are service-role/admin only (RLS on, no anon grants, matching the `payoff_stats` precedent). Candidate geometry is unpublished IP and must never reach the anon Data API. Admin RPCs stay `SECURITY DEFINER` gated by `is_admin()`.

## 15. Performance / scalability

Extra per-job cost is one bounded insert batch (candidate + gates) inside the existing 500ms research deadline; zero extra MetaApi calls. Replay grows linearly in enrolled candidates, capped by the new budget. Row growth is dominated by candidates: ~3 instruments × 2 directions × 96 cycles/day ≈ 576 rows/day worst case; needs a retention policy (recommend 180 days, matching `regime_snapshots`).

## 16. Implementation sequence

1. Provenance query on the 156 unlinked shadow rows; classify before touching aggregates.
2. Capture baseline snapshot (§19) into `baseline_snapshots`.
3. Fix defect 4 (`replay_version` filter) + freeze vol boundaries (defect 5) — pure correctness, no candidates yet, rebuild and diff against baseline.
4. `evaluateSetup()` refactor + regression test proving identical publications on recorded fixtures.
5. Migration: `research_candidates`, `candidate_gate_outcomes`, `strategy_manifests`, `shadow_executions.cohort`, cohort/manifest keys on aggregates.
6. Candidate capture only (no enrolment). Observe funnel for ≥1 week.
7. Candidate enrolment behind switch, small budget, cohort-scoped aggregates.
8. `recompute_filter_lift` + admin panel.
9. Separate `k_fill`/`k_win` + empirical-Bayes k, with side-by-side calibration comparison before promotion.

## 17. Test matrix (concrete)

- **Unit / geometry:** bullish and bearish fixtures with hand-computed values — long entry 1.1000, structural extreme 1.0950, M15 ATR 0.0010, H1 ATR 0.0016 → buffer `max(0.0012, 0.0008, spread)` = 0.0012, stop 1.0938, risk 0.0062; barrier 1.1200 → `maxR = 3.23` → ladder [1,2,3], TP1 1.1062, TP2 1.1124, TP3 1.1186. Edge cases: `maxR = 1.49` → `[0.89,1.49,null]`; risk 0 → `stage='risk_undefined'`; barrier behind entry → `stage='no_headroom'`; malformed candles (empty, single bar, NaN, non-monotonic times) → labelled stage, never a throw.
- **Property/invariant:** for every fixture, `buildTradeProfile()` output ≡ `evaluateSetup()` output when all gates pass; exactly one terminal stage per candidate; gate outcomes are a prefix-closed sequence.
- **Statistical:** k-shrinkage fixture (`x=25,n=32,parent=0.510638,k=30 → 0.650309`); EB-k moment estimator on synthetic buckets with known dispersion; `Δ_g` on a synthetic cohort with known truth (+0.20R) recovered within the reported clustered SE.
- **Integration:** one pipeline run over fixture candles writes exactly 1 signal, 1 `model_observations` row per model, N candidate rows, and 0 rows in alerts/push/webhook/journal spies.
- **DB/RLS:** anon and authenticated SELECT on `research_candidates` denied; admin RPC returns rows; `cohort` CHECK rejects unknown values.
- **Regression:** replay hash invariants unchanged; `recompute_regime_stats` on frozen input reproduces the exact current live numbers (p_fill 0.281437, p_win 0.510638) when candidates are absent.
- **Failure injection:** candidate insert error, deadline breach, duplicate `(run_id, instrument, direction)`, concurrent workers claiming the same structure, MetaApi timeout mid-fetch, partial batch write — in every case the production job result is byte-identical and research health is incremented.
- **E2E / shadow:** candidates enrolled with the switch off produce zero shadow rows; with it on, live priors before/after rebuild are identical because of the cohort filter.

## 18. Failure-mode simulations

Timeout (research write exceeds 500ms → dropped, counter incremented, job unaffected); duplicate cron invocation (unique key makes capture idempotent); retry after partial write (gates re-inserted with `ON CONFLICT DO NOTHING`); concurrent workers (advisory lock in recompute, structure claim for enrolment); provider unavailable (no candles → no observation, no candidate — same rule as today); stale job (>15 min → closed before fetching, so no candidate); DB partial failure (candidate written, gates lost → candidate marked `gates_incomplete` and excluded from lift, never silently counted as "all gates passed").

## 19. Baseline vs corrected-model comparison

Capture now into `baseline_snapshots`: 338 shadow rows / 334 resolved / 94 filled / p_fill 0.281437 / p_win 0.510638 / mean R per plan -0.028590 / mean R given executable -0.091408; grade, instrument, session and long/short distributions; never-filled 156 of 227 mature; queue latency p50/p95 and result mix; duplicate suppression counts; alert counts; risk-calculator outputs for a fixed fixture; MCP tool outputs for a fixed query. **Not computable today:** any candidate-cohort baseline, any per-gate lift, and any V1 rejection-stage distribution — that data has never been recorded. `model_observations` holds one day (104 rows), too little for a funnel baseline.

## 20. Deployment / shadow / canary plan

Every stage ships dark: capture-only first, then enrolment behind `candidate_enrolment_enabled` with a small row budget, then lift reporting, then (separately) the k change. Nothing promotes into trader-facing priors in this plan.

## 21. Rollback plan

Switches off restores today's behaviour without dropping anything. `evaluateSetup()` reverts by reverting the adapter (no schema dependency). Aggregate PK changes ship with a forward-fix migration that recreates the previous function bodies; `regime_snapshots`/`payoff_snapshots` retain history, so a rebuild is always reproducible. Candidate tables are additive — dropping them cannot affect production. Kill switch for enrolment is a DB flag read per run, so it takes effect within one cycle.

## 22. Acceptance criteria

Publication behaviour byte-identical on fixtures; every V1 rejection carries exactly one labelled stage; every candidate carries reproducible features and proposed geometry; live `regime_stats`/`payoff_stats` numerically unchanged after cohort scoping; zero candidate rows reachable by anon, authenticated, MCP, feed, email, push, webhook or journal; zero extra MetaApi calls per run; per-gate lift reported with n, coverage, clustered SE and a `descriptive`/`insufficient_*` status.

## 23. Remaining uncertainties

Provenance of the 156 unlinked shadow rows; how much of the candidate cohort will ever fill (rejected structures may be systematically less reachable, which is itself a finding); whether tier-2.5 grade buckets will clear their n floor this year; whether EB-k improves calibration enough to justify replacing a constant.

## 24. What I cannot guarantee

I cannot guarantee that observed gate lift is causal — it is confounded by gate correlation and by regime non-stationarity. I cannot guarantee candidate replay fills are broker-realistic beyond what M15 OHLC supports (intrabar path is unknown; ambiguity flags remain the only honest signal). I cannot guarantee the 2s CPU envelope for unbounded candidate volumes — only for the budgeted path. I cannot promise a timeline to statistical maturity, because fill rate, not calendar time, controls it.

## 25. Final recommendation

Proceed — with one explicit modification to your framing: capture candidates in a dedicated table but forward-test them through the **existing** `shadow_executions` replay with a `cohort` discriminator, rather than a parallel candidate replay engine, and treat filter lift as an observational hypothesis rather than proof. Stage 1 (provenance + defects 4 and 5) is worth doing regardless of whether the candidate architecture is approved.
