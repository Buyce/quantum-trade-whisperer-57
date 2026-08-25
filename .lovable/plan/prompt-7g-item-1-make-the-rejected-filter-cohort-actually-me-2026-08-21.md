# Prompt 7G Item 1 — make the rejected-filter cohort actually measurable

## The defect (verified in code)

Filter lift compares two arms per gate: candidates where the gate passed vs candidates where it failed. Today the "fail" arm can never contain a single observation, so the whole research engine still measures only what V1 published.

Chain, as currently implemented:

- `evaluateSetup()` (src/lib/scanner/profile.ts) fills `proposedProfile` only at stage `published`. Every rejection returns `proposedProfile: null`.
- `captureCandidate()` (src/lib/research/candidates.server.ts) takes `grade`, `tp1..tp3`, `tp1_r..tp3_r`, `max_r`, `confidence_score` exclusively from `proposedProfile`, so rejected rows store those columns as NULL.
- `isExecutableCandidate()` (src/lib/research/enrol-candidates.server.ts) requires `grade`, `tp1`, `tp2`, `tp3`, all three R values and `max_r` to be non-null. A rejected candidate therefore fails executability by construction and sits in the backlog forever.
- `recompute_filter_lift()` only counts candidates that have a joined `shadow_executions` row, so every gate's `fail` arm resolves to `n_used = 0` / `unavailable`.

Separately, rejections differ in kind and are currently treated identically:

- `no_candles`, `m15_neutral`, `no_grade`, `no_abc`, `risk_undefined` — no ABC leg and/or no derived entry/stop exist. Nothing executable can be formed without inventing prices.
- `risk_too_wide`, `no_headroom`, `unreachable_r` — the geometry block already ran: `entry_price`, `stop_loss`, `risk_price`, `atr`, `structure_key` and `direction` are all genuinely derived. Only a _filter_ rejected the setup.

## What to build

### 1. Gate classification on the evaluation

Add one field to `SetupEvaluation`: `counterfactual` — `"executable"` when the terminal stage is `risk_too_wide`, `no_headroom` or `unreachable_r` (derived geometry present), otherwise `"structurally_not_evaluable"`. Published rows stay `"executable"`. No maths in `evaluateSetup()` changes; publication behaviour is byte-identical (characterization suite must stay green).

### 2. A frozen counterfactual R ladder, stored separately from the production plan

Rejected-but-geometrically-complete candidates get a research-only ladder derived from values that already exist — never from a re-run of the filters that rejected them:

```text
risk = |entry - stop|      (already stored as risk_price)
tp1_r = 1, tp2_r = 2, tp3_r = 3    (fixed, version-pinned)
tpN   = entry ± risk * tpN_r
max_r = 3
```

This is deliberately unconditional: headroom and reachable-R are exactly the filters under test, so the counterfactual cannot consult them. The ladder rule is pinned by a `research_plan_version` constant so a future change cannot silently repool old rows.

Storage: new columns on `research_candidates` — `plan_origin` (`'production'` | `'counterfactual'`), `counterfactual_stage`, `research_plan_version`. Production rows keep `plan_origin='production'` and their published values untouched. Counterfactual rows fill the existing `tp*`, `tp*_r`, `max_r` columns from the ladder above, with `grade` taken from the already-recorded `features.gradedTier` (a real graded tier, not a guess) and `confidence_score` left NULL.

### 3. Enrolment accepts counterfactual plans

`isExecutableCandidate()` keeps every hard guard (complete gate list, real direction, non-null geometry, positive risk, no `not_evaluable` gate) but stops requiring a production grade/confidence. Enrolled executions stay in `cohort='research_candidate'`, Replay-V1, `legacy_best_target_touched`, with `research_candidate_id` set — unchanged. Dark switches stay FALSE.

### 4. Filter lift reports plan origin

`recompute_filter_lift()` gains `plan_origin` in its grouping key and output so a pass-arm production plan is never averaged together with a counterfactual plan. Panel shows the origin split.

## Guarantees

- Nothing writes to `scanned_signals`, `market_context` or `executed_trades`; no trader-visible surface changes.
- No price is ever invented: counterfactual targets are arithmetic on an entry and stop that were already derived from real candles.
- `candidate_capture_enabled` and `candidate_enrolment_enabled` remain FALSE after this change.

## Tests to add (blocking)

- Classification: each terminal stage maps to the expected `counterfactual` value; the three geometry-complete stages carry non-null entry/stop/risk/atr.
- Counterfactual ladder: exact 1R/2R/3R prices for long and short; NULL ladder for structurally-not-evaluable stages.
- Executability: a counterfactual candidate enrols; one with any missing geometry never does.
- Provenance: enrolled counterfactual execution carries cohort, Replay-V1, the legacy policy, `research_candidate_id`, and zero Replay-V2 siblings.
- Isolation (DB): a counterfactual candidate changes zero regime, payoff and weekly production values.
- Characterization: `ab44ff6` publish/no-trade equality unchanged.
