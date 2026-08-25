# Wave 1 — Revised Plan (Second-Pass Audit)

## Executive verdict

The first plan's sequencing was right; two of its statements were wrong and one
was unsafe. It is approvable only after the corrections below. All 16 findings
were checked against HEAD and the live database; three are already handled by
existing machinery and should NOT be rebuilt, two are only partially true, and
one (F14) is materially overstated by the review.

### What the first plan got right

Lifecycle before exposure; five pairs non-public and non-executable; service-role
only stage changes; explicit refusal reasons; fail-closed sizing; no synthetic
data; docs contract tests; measured worker capacity; independent promotion.

### What the first plan got wrong

1. It proposed the predictive challenger write `model_version = 3`. That number is
   already taken and registered (see F1). Hard collision.
2. It claimed lifecycle suppression is harmless. Suppressing `scanned_signals`
   also suppresses V1 outcome learning, because enrolment is a trigger on that
   table (F2). Suppressed pairs would have learned nothing.
3. It leaned on the existing evidence gate for promotion. That gate cannot reach
   `actionable` by construction (F3).
4. It asserted "byte-identical" behaviour and quoted an unvalidated 0.02 USDJPY
   spread floor (F8, F16).

## Verdicts, with evidence

**F1 — Confirmed (critical).** `src/lib/scanner/v3/manifest.ts` defines
`MODEL_V3_VERSION = 3`, `enrolV3Shadow` in `src/lib/research/enrol.server.ts`
writes `shadow_executions.model_version = 3`, and `model_versions` holds
`1: V1 production engine | 2: v2-canonical-abc-research | 3: v3-corrected-geometry-research`.
Correction: predictions get their own identity, not a strategy version. New
`prediction_models` registry (`prediction_model_id`, `artifact_version`,
`feature_schema_version`, `training_cutoff`, `code_hash`) and prediction rows that
*reference* `strategy_model_version` (1/2/3) instead of occupying it. No numeric
V4 is minted for a non-geometry model.

**F2 — Confirmed (critical), and the fix already exists.** Live triggers on
`scanned_signals`: `shadow_enroll_on_signal` → `enroll_shadow_signal()` and
`enqueue_execution_deliveries_trg`. So a pair that never publishes gets no V1
shadow row. But V2/V3 already prove the correct pattern: `enrolV2Shadow` /
`enrolV3Shadow` write `shadow_executions` in-pipeline with `signal_id = NULL`, and
`src/lib/execution/shadow_resolve.server.ts` resolves them by replay filtered on
`model_version`. Wave 1 therefore adds an **in-pipeline, cohort-labelled V1-geometry
enrolment for lifecycle-suppressed instruments** — same frozen plan fields, same
replay resolver, no trigger, no `scanned_signals` write.
Documented path: candles → `evaluateSetup` → lifecycle suppression → in-pipeline
shadow enrolment (frozen entry/stop/TP/R + `observation_key`) → replay resolution →
cohort statistics → promotion evidence.
Runtime fact that changes the plan: `shadow_engine_state` currently reads
`v2_enabled = false, v3_enabled = false, candidate_capture_enabled = false,
candidate_enrolment_enabled = false` and `research_candidates` has **0 rows**. The
research plane is dormant, so Wave 1 must explicitly enable bounded capture for the
new pairs — it cannot assume research is already flowing.

**F3 — Confirmed.** `src/lib/stats/evidence.ts` exports `HOLDOUT_AVAILABLE = false`
and `holdoutConfirmed()` returns it, so `actionable` is unreachable and
`MIN_GROUP_SAMPLES = 30` / `MIN_GROUP_CLUSTERS` are descriptive only. Three
distinct gates are defined below; the existing gate is reused unchanged for the
descriptive layer only.

**F4 — Partially confirmed.** The fragmentation is worse than the review states:
besides `INSTRUMENTS`, `ALL_INSTRUMENTS`, `INSTRUMENT_LABELS`, `CONTRACT_SPECS`,
`SPREAD_FLOOR` and the docs contract, the **database column default** of
`scanner_settings.instruments` is a fourth hard-coded list
(`ARRAY['XAUUSD','GBPAUD','EURUSD']`), and `specs.server.ts`, `provision.server.ts`,
`conversion.server.ts` and `routes/api/public/quotes.ts` all derive from
`INSTRUMENTS`. Correction: one typed code registry for *definitions* (symbol, base,
quote, digits fallback, contract size, lot step, label, wave), DB lifecycle table for
*operational state*, `connected_account_symbols`/`connected_account_specs` for
*account-specific mapping*, `broker_symbol_specs` for *broker-authoritative* facts,
and a new versioned cost table for *empirical* spread. Broker and account facts stay
where they are — they are not moved into the registry.

**F5 — Confirmed as missing.** Continuity matrix below. No existing row is
rewritten; every instrument column is free-form text (no check constraint pins
instrument names), so expansion needs no data migration at all.

**F6 — Confirmed.** Restated with separate estimands and, given 0 candidate rows
today, deliberately deferred: no ML infrastructure is built in Wave 1.

**F7 — Confirmed.** Per-instrument characterisation is required; maturity is never
inherited.

**F8 — Partially confirmed.** `SPREAD_FLOOR` has 3 entries and
`DEFAULT_SPREAD_FLOOR = 0.0002`; that default is dimensionally wrong for a
3-digit JPY pair. But 0.02 is an unvalidated guess, so the plan does **not** hard-code
it: the JPY floor is derived from the broker's own `point`/`digits`
(`broker_symbol_specs` already stores `point`, `point_source`, `digits`,
`stops_level`) times a measured spread percentile, and until that measurement exists
the pair stays in `data_validation`. V1's three existing floors are frozen verbatim.

**F9 — Partially confirmed.** Sessions are fixed UTC and already single-sourced:
`scannerSessionOf` in `src/lib/market-hours.ts` mirrors `sessionOf` in
`pipeline.server.ts`. DST drift is real but correcting it would silently reinterpret
125 existing signals and 482 existing shadow rows. Correction: keep V1 boundaries
frozen, add a nullable `session_definition_version` to new observation writes
(`market_context` has no such column today), and only a versioned challenger may use
DST-aware boundaries.

**F10 — Confirmed, and one product decision reversed.** No calendar integration
exists anywhere in `src/`. The first plan's "publish but label" contradicts the
stated no-high-impact-news policy. Recommended safest coherent behaviour:
**research capture + feed display with an explicit warning + no alert + no automatic
execution**, because full suppression destroys the very research needed to validate
the rule, while alerting invites the trade the policy forbids.

**F11 — Already handled.** Both systems exist and are explicitly documented as
non-mergeable: `src/lib/delivery/exposure.ts` (journal, advisory unless
`exposure_limit_enabled`) and `src/lib/execution/exposure-account.ts`
(broker-derived, fail-closed, blocks submission). Wave 1 extends each separately,
never merges them.

**F12 — Already handled structurally; one gap.**
`src/lib/delivery/revalidate.server.ts` is the single pre-send gate ("NOTHING leaves
this system without passing here") and already re-checks
`execution_controls.disabled_instruments`, per-user settings, live quote freshness
and the stored spec. The lowest authoritative boundary therefore already exists:
lifecycle stage and news state are added **there** (and to `submitDirectOrder`'s
shared call path), not as duplicate rules. Queued deliveries for a demoted or
suspended instrument end as `rejected` with a named reason — the existing terminal
path, no new state machine.

**F13 — Confirmed.** Add `disabled | data_validation | shadow | signals_only |
execution_approved | suspended`, an append-only transitions table (approver,
reason, evidence snapshot, code hash, rollback target), and a **restricted
projection** for customers exposing stage only — approver identity and operational
notes stay service-role.

**F14 — Partially confirmed; materially overstated.** Live check: 5 rows in
`scanner_settings`, **0** with a null/empty `instruments` array, all 5 with exactly
3 instruments, column default `ARRAY['XAUUSD','GBPAUD','EURUSD']`. So no existing
user is currently exposed to auto-opt-in. The real defects are in code:
`eligibility.ts` line 88 treats an empty array as no filter, and `settings.tsx`
seeds state from `ALL_INSTRUMENTS`. Correction (smaller than proposed): pin both
the UI default and the column default to the Wave 0 set, and require explicit
inclusion for any instrument outside it — no data migration needed.

**F15 — Confirmed.** `instrument_health` is per-instrument
(`available`, `unavailable_until`), but `shadow_engine_state` carries **global**
`paused`, `consecutive_failures`, `research_errors`. A new pair failing repeatedly
would pause research for Gold. Add per-instrument research failure counters and a
per-instrument breaker; the global breaker is reserved for provider-wide failure.

**F16 — Confirmed.** Parity is demonstrated by tests and observed output, not
asserted. Flagged rollout sequence below.

## Corrected scope

Wave 1 delivers: registry + lifecycle (F4, F13), research enrolment and resolution
for suppressed pairs (F2), three independent gates (F3), precision/cost correctness
(F8), the five pairs in `data_validation` (F7), failure isolation (F15), pre-send
revalidation extension (F12), opt-in safety (F14), and per-instrument
characterisation. News (F10) is scoped to schema + gate + provider evaluation.
The predictive challenger (F1, F6) is scoped to identity/registry design and
prediction-record schema only — no model is trained.

## Existing-data continuity matrix

| Object | Treatment | Backfill |
| --- | --- | --- |
| `scanned_signals` (125 rows) | unchanged | none |
| `market_context` | add nullable `session_definition_version` | none — old rows stay unknown |
| `executed_trades`, `broker_trade_evidence` | unchanged | none |
| `model_versions` (1,2,3) | unchanged; predictions never mint a version | none |
| `model_observations`, `research_candidates` (0 rows) | extended with cohort label | none |
| `shadow_executions` (482 V1 rows) | extended with a research-cohort flag | none |
| `regime_stats`, `regime_snapshots`, payoff tables | unchanged; new cohorts are separate | none |
| `scanner_settings` | column default pinned to Wave 0 | none |
| `connected_trading_accounts`, `*_specs`, `*_symbols` | unchanged | new symbols mapped on refresh |
| `execution_deliveries`, `execution_enqueue_decisions` | new refusal reasons only | none |
| `broker_symbol_specs` (3 symbols) | new symbol rows added by the daily job | factual only |
| `instrument_health` | unchanged | none |

Unknown history stays unknown: no old session relabelling, no synthetic spreads, no
back-dated news, no cohort reclassification. Rollback is per stage: drop the flag,
and the new tables become inert.

## Promotion gates (independent per instrument)

- **`data_validation` → `shadow`** — operational only, no statistics: symbol mapped
  unambiguously on the benchmark account, broker `digits`/`point` present and fresh,
  candle completeness per timeframe, quote freshness, conversion route resolvable
  for every supported account currency, queue processing stable, zero unresolved
  data-integrity failures.
- **`shadow` → `signals_only`** — resolved forward observations meeting the existing
  descriptive gate (`MIN_GROUP_SAMPLES`, day clusters), cost-adjusted behaviour
  stable, manual review of accepted and rejected candidates, correct feed/alert
  presentation, honest evidence labels. No execution authority.
- **`signals_only` → `execution_approved`** — genuine untouched forward holdout
  (the holdout mechanism itself is new work; historical backfill can never satisfy
  it), broker execution evidence, cost-adjusted net expectancy, calibration and
  stability, portfolio controls, news protection, pre-submit revalidation,
  emergency suspension and a tested rollback.

Thresholds are set from each instrument's own measured setup frequency, not a
borrowed sample number.

## Stages

Each stage lists reuse / additive / behaviour / DB / user impact / failure / tests /
observability / rollback / dependency / completion evidence.

**Stage 1 — Registry + lifecycle, read-only behind a flag.**
Reuse: `execution_controls.disabled_instruments`, `revalidate.server.ts`,
`instrument_health`. Additive: typed registry module, `instrument_lifecycle`,
`instrument_lifecycle_transitions`, customer projection. Behaviour: none —
enforcement off. DB: three additive objects with grants then RLS then policies.
User impact: none. Failure: lifecycle read failure falls back to the frozen Wave 0
registry for existing pairs and to "suppressed" for new pairs. Tests: parity
snapshots for the three live pairs across direction, grade, entry, stop, targets, R,
structure key, confidence, pillars, gates, publication, alerts, eligibility, sizing,
enqueue and final refusal. Observability: stage read counters. Rollback: drop flag.
Completion: dual-path comparison shows zero diffs.

**Stage 2 — Enforcement on for existing pairs only**, after parity holds.

**Stage 3 — Five pairs added at `disabled`, then `data_validation`.** Registry
entries, spec-refresh coverage, quotes route, FX routes, JPY floor derived from
broker `point`; per-instrument breakers and research failure counters (F15).
No publication, no alerts, no orders.

**Stage 4 — Suppressed-candidate research enrolment + resolution** (F2), bounded
rows per run, gated by its own switch, cohort-labelled.

**Stage 5 — News schema, deterministic states and the gate** (F10), fail-closed for
automatic execution, provider chosen only after licensing and rate-limit review.

**Stage 6 — Exposure extensions** (F11) in both systems, kept separate.

**Stage 7 — Prediction registry and immutable prediction records only** (F1/F6). No
training, no scoring in the production path; removable without touching V1/V2/V3.

## Capacity and acceptance thresholds

Measured: 11-16 scan jobs/hour, mean job 2.7-7.9s, worst 15.2s; worker does 3 jobs
per pass, 20s budget, 8 hops. Eight instruments ≈ 40-60s per cycle → 3-4 hops.
Added load: 8 spec refreshes/day, 8 quotes per quote call, news polling, plus
bounded research writes. Acceptance: queue age p95 < 5 min; cycle completion < 5
min; provider error rate < 5% per instrument; stale-job rate 0; candle completeness
≥ 99%; research failure rate < 5%. Breach of any two for two consecutive hours is
the rollback trigger.

## Red-team review of this plan

Attacked and addressed: version collision (F1, separate identity); prediction
semantics inside a strategy number (rejected); candidates without outcomes (F2,
in-pipeline enrolment plus replay); history reinterpretation (frozen sessions,
versioned new writes); backfill contaminating holdout (holdout is forward-only by
construction); pooled evidence promoting a weak pair (gates are per instrument);
JPY maths (broker-derived, not the guessed 0.02); missing conversion routes
(pre-resolution test per account currency); stale spec fallback (existing staleness
refusals reused); symbol ambiguity (existing `ambiguous` refusal); time-of-check /
time-of-use (lifecycle and news added to the existing single pre-send gate);
silent opt-in (defaults pinned to Wave 0); global breaker contamination (per
instrument counters); queue starvation (bounded research work, measured budget);
news outage presented as safe (fails closed); correlated USD exposure (both exposure
systems extended); RLS/licensing (customer projection, provider review before
ingest); irreversibility (all changes additive and flag-gated); documentation ahead
of functionality (docs contract test pins the instrument list to the code
constants).

Residual risks accepted and stated: the holdout mechanism is new and unproven; news
licensing may not permit storage, which would force a narrower gate; and the
predictive challenger may never be justified at this sample size.

## Product decisions needing your confirmation

1. News policy: research capture + labelled feed + no alert + no automatic
   execution (recommended) versus full suppression.
2. News provider and budget, given licensing and storage rights.
3. Which geometry the suppressed-pair research cohort uses — frozen V1, or enabling
   the currently dormant V2/V3 cohorts for the new pairs only.
4. Whether existing users must explicitly opt in to each new pair (recommended) or
   inherit them at `signals_only`.

## Final approval recommendation

Approve Stages 1-4 now. Stages 5-7 are approved in design only and each returns for
confirmation before implementation, because they depend on the four decisions above.
