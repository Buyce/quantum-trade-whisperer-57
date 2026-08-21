# V2 Grading Shadow — Final Specification Lock (PLAN ONLY)

Prompt 3D resolutions folded into the approved 3C architecture. P1–P7 from the earlier review still bind. Nothing is implemented in this prompt.

## 1. Exact control structure (removes the early-return contradiction)

`processNextJob()` keeps its existing `finish(status, detail)` helper and its exact return values. The V1 policy branches stop *returning* directly; they assign a disposition and fall through to one shared exit. Shape:

```text
claim job; stale-job guard            (unchanged)
fetch H4/H1/M15                       (unchanged; on throw -> existing catch, no observations)
clearInstrument                       (unchanged)
now / session / volatility            (already hoisted today)
snapshot = { candles, now, session, run_id }   // frozen object, passed by reference to both models

v1 = evaluateV1(snapshot)             // buildTradeProfile, byte-identical args
v2 = safeEvaluateV2(snapshot)         // try/catch -> {decision, profile?, reason?}

research.recordObservation(v1)        // best-effort, see §2
research.recordObservation(v2)        // best-effort

// ---- V1 policy, same predicates, same order, same detail strings ----
let outcome: JobResult["status"] | null = null
if (!v1.profile) outcome = "no_trade"
else if (cooldownHit(v1.profile.structureKey)) outcome = "duplicate"
else {
  insert scanned_signals
  if (23505) outcome = "duplicate"
  else if (insert error) throw                    // unchanged catch behaviour
  else {
    insert market_context (+ existing compensating rollback -> outcome "failed")
    if (ok) { alert fan-out in try/catch; outcome = "published" }
  }
}

// ---- V2 research policy, isolated, runs for every outcome above ----
research.applyV2Policy(v2, snapshot)  // cooldown claim + shadow insert, best-effort

research.updateDispositions(v1Outcome, v2Outcome)   // best-effort

return finish(outcome, sameDetailAsBefore)
```

Guarantees: the V1 predicates, their order, the payloads, the alert call site, the compensating rollback and every `detail` string are unchanged, so the returned `JobResult` is identical to today's for every input; and because the V2 block sits after the policy chain but before the single `return`, it executes for V1 candidate, V1 no-trade, V1 cooldown-suppressed and V1 23505-duplicate alike. The `failed` path from the `market_context` rollback also reaches the V2 block; the throw path (non-23505 insert error) does not, which is correct — that is a production incident, not a research opportunity.

## 2. Research telemetry is never a production dependency

Every research call is wrapped individually — observation upsert, cooldown RPC, shadow insert, disposition update — each in its own `try/catch` that logs, increments a counter, and returns. None of them can throw into V1's path, and none of them is awaited before a V1 write. Nothing in the research path touches `scan_queue`, `instrument_health`, `scanned_signals`, `market_context`, alerts or `shadow_queue`.

Visibility instead of silence: `shadow_engine_state` gains `research_errors integer not null default 0` and `research_last_error text`, bumped on any research failure, and the admin panel shows research-error count plus the observation-coverage ratio (observations written ÷ jobs that fetched candles, last 24 h). A gap in the ledger is therefore visible as a number, not inferred from absence. Production correctness wins every conflict: if the research write is slow or failing, V1 proceeds unchanged and the observation is simply missing.

## 3. `buildTradeProfileV2()` — complete component specification

| Component | V2 | Specification |
|---|---|---|
| Direction derivation | inherits | `readTimeframe("M15")` bias; neutral ⇒ no trade. |
| A/B pivot selection | replaces | §4, deterministic, no search-until-valid. |
| Point C | replaces | §7 of prior plan, restated below: current retracement extreme after `B`, confirmed-bar only. |
| Retracement band | adds | `[0.382, 0.886]` mandatory (V1 has no band). |
| Structural entry | inherits | Point C price (V2's C, not V1's `abc.c`). |
| Session dynamic entry | inherits unchanged | `RUNAWAY_SESSIONS`, `DYNAMIC_ENTRY_ATR_FRACTION = 0.3`, all four existing guards (not worse than market, never beyond structural entry, `MIN_DYNAMIC_RISK_ATR = 0.5` clearance from stop, re-validated risk/reach). |
| Structural stop anchor | inherits | last 10 M15 bars' extreme, opposite side. |
| M15 ATR stop multiplier | inherits | `STOP_M15_ATR_MULTIPLIER = 1.2`. |
| H1 ATR floor | inherits | `STOP_H1_ATR_FLOOR = 0.5`. |
| Spread floor | inherits | `SPREAD_FLOOR[instrument] ?? DEFAULT_SPREAD_FLOOR`. |
| Max-risk-ATR rejection | inherits | reject when `risk > MAX_RISK_ATR (3) × m15.atr`. |
| H4 barrier | **corrects** | one canonical directional barrier from confirmed unbroken H4 pivots (the `directionalHeadroomAtr` construction), used for **both** the grade headroom gate and `maxR`. V1 grades on pivots but computes `maxR` from `h4.rangeHigh/rangeLow` — the two disagree; V2 removes that split. |
| Minimum reachable R | inherits | `MIN_REACHABLE_R = 1`. |
| Open-space barrier | adds | §J: finite extension `entry ± EXTENSION_ATR × h4.atr`, never `Infinity`. |
| Target ladder | inherits | identical thresholds: `maxR ≥ 3 ⇒ [1,2,3]`; `≥1.5 ⇒ [0.5,0.75,1.0]×maxR`; else `[0.6,1.0]×maxR` with `tp3R = null`. |
| TP nullability | inherits | `tp3` may be null (see §11). |
| R:R headline | inherits | `tp3R ?? tp2R`. |
| Max acceptable entry | inherits | `SLIPPAGE_TOLERANCE_R = 0.15`, `TIGHT_SLIPPAGE_TOLERANCE_R = 0.10` when `maxR < 1.5`. |
| Pillar 1 trend | inherits | alignment score logic unchanged. |
| Pillar 2 order zone | **corrects** | zone distance normalised by native-timeframe ATR at the zone's own index (§7). |
| Pillar 3 momentum | inherits | M15 RSI extreme/divergence at Point C. |
| Pillar 4 volatility | **corrects** | continuous transform (§5) replacing the step function. |
| Confluence score | inherits | same weights, same R:R multiplier cap, symmetry still excluded from the score. |
| Grade | **replaces** | family + quality grade per the 3C truth table: continuation requires H4/H1/M15 alignment; H4-neutral is no trade; M15-opposed is `mean_reversion_candidate` (observation-only); EMA200 unavailable ⇒ `insufficient_data`. |
| Structure key | inherits shape | `instrument|direction|aTime|bTime|stopLoss(5dp)`, computed from V2's A/B. |
| Symmetry | inherits, unscored | recorded as diagnostic only. |

Anything not in this table is not V2's to change; no mechanic may be invented at implementation time.

## 4. Deterministic A/B selection

Single pass, no search:

1. Compute `swings(M15, 2)` on the frozen snapshot.
2. `B` = the **most recent confirmed pivot of the required kind** (high for long, low for short).
3. `A` = the **nearest preceding confirmed opposite-kind pivot** satisfying the directional leg requirement (`B.price > A.price` for long, mirrored for short) with a non-zero leg.
4. `C` = derived only from bars strictly after `B.index`.
5. If that single `(A, B, C)` triple fails chronology, bounds or the retracement band ⇒ **no valid continuation**. No fallback to older pairs, no widening of the band, no alternative pivot windows.

This is deliberately the most restrictive defensible rule: iterating candidate pairs until one qualifies is parameter search dressed as detection, and it would inflate the V2 candidate rate in a way no honest comparison could survive.

## 5. Volatility transform — locked

Confirmed as designed:

```text
v(r) = 0                              r <= 0
v(r) = 60 r                           0 < r <= 1
v(r) = 60 + ((r - 1)/0.6) * 40        1 < r <= 1.6
v(r) = 100                            r > 1.6
```

`r = m15.atr / mean(atr, 20)`. Continuous at 0, 1 and 1.6; monotone non-decreasing; pass set unchanged (`r ≥ 1` ⇒ `v ≥ 60 = PILLAR_PASS_SCORE`). Boundary tests: `v(-1)=0`, `v(0)=0`, `v(0.999)=59.94`, `v(1)=60`, `v(1.3)=80`, `v(1.6)=100`, `v(2.5)=100`, and `v(NaN)`/`v(Infinity)` ⇒ fail-closed 0.

## 6. `atrAtIndex` and lookahead

Formula: Wilder-style true range mean over the 14 bars ending at `i` — `TR_t = max(high−low, |high−prevClose|, |low−prevClose|)`, simple mean of `TR_{i-13..i}`. Reads only indices `≤ i`, never `i+1`.

Warm-up: `i < 14` ⇒ insufficient history. Insufficient history returns `null` (not 0, not NaN) and the caller fails closed — the zone pillar scores 0 and, where the value is structurally required, the observation becomes `insufficient_data`. Non-finite inputs ⇒ `null`.

Prefix-invariance test: for every `i` in a fixture, `atrAtIndex(candles.slice(0, i+1+k), i) === atrAtIndex(candles, i)` for all `k ≥ 0` — appending future bars cannot move a historical value. A second test asserts the current V1 `atr()` value equals `atrAtIndex(candles, last)` so the two definitions cannot drift.

## 7. Native-timeframe zone normalisation

H1 zone distances are divided by `atrAtIndex(H1, zoneIndexH1)`; H4 zones by `atrAtIndex(H4, zoneIndexH4)`. M15 ATR is used **only** for M15 measurements (stop buffer, risk ceiling, volatility ratio). Mixing an M15 ATR into an H1/H4 distance makes every higher-timeframe zone look far away by roughly the timeframe ratio, which is the defect being corrected. No exception is justified, so none is granted.

## 8. Immutable V2 manifest, registered before the first observation

Phase 3's migration inserts `model_versions` version `2` **before** `v2_enabled` can be flipped, with `components` recording: Point-C algorithm + parameters, pivot lookback (2 for M15 A/B, 5 for H4 barrier pivots), retracement band `[0.382, 0.886]`, the full grading truth table, barrier algorithm + `PIVOT_MIN_SEPARATION_ATR`, `EXTENSION_ATR`, entry/stop/target constants (all values in §3), volatility transform, zone normalisation rule, closed-candle assumption note (§12), `code_hash` = Git SHA of the V2 modules, and a canonical manifest hash (stable-key JSON, SHA-256).

A startup/CI assertion compares the computed manifest hash to the registered row; a mismatch fails `bun run verify`. Consequence, stated plainly: once any V2 observation exists, changing a listed mechanic requires **version 3** and a new cohort — V2 rows are never re-graded or re-labelled. Runtime `v2_enabled` lives in `shadow_engine_state` and is explicitly not part of model identity.

## 9. `EXTENSION_ATR = 6` is a research hyperparameter

Not empirically validated; there is no data on open-space outcomes at all. Alternatives considered: **no candidate when no structural barrier exists** — cleanest, but discards exactly the strong-trend continuations the model is meant to study; **fixed 3R cap** — couples the barrier to the stop, so identical structures with different stop buffers get different barriers, and it makes the `maxR ≥ 3` ladder branch unreachable in open space by construction; **4 ATR** — plausible, but would cap `maxR` below the 3R ladder for typical risk sizes, quietly biasing open-space setups into the thin-ladder branch; **6 ATR** — leaves the 3R ladder reachable for typical risk while still bounding the number, which is the only property actually required here. Recorded in the manifest and first on the sensitivity-analysis backlog (re-run V2 stats at 4/6/8 ATR and no-candidate once ≥100 open-space resolutions exist).

## 10. V2 cooldown identity

`structure_key` already embeds instrument and direction (`instrument|direction|aTime|bTime|stopLoss`), so it is globally unique in practice — but that is a property of a function V2 could later change, so the claim is not allowed to depend on it. Claims are keyed on the tuple `(model_version, instrument, direction, structure_key)`:

`v2_structure_claims (model_version smallint, instrument text, direction text, structure_key text, claimed_at timestamptz not null, primary key (model_version, instrument, direction, structure_key))`.

`claim_v2_structure(_model_version, _instrument, _direction, _key, _window_minutes)` is `SECURITY DEFINER` and performs one atomic statement: `INSERT ... ON CONFLICT (pk) DO UPDATE SET claimed_at = now() WHERE v2_structure_claims.claimed_at < now() - (_window_minutes || ' minutes')::interval RETURNING true`, returning whether this caller won. Invariant: exactly one winning claim per key per 120-minute window, proven by a concurrency test issuing two simultaneous claims.

## 11. Target nullability

V2 **preserves the adaptive ladder**: `tp1` and `tp2` are required and finite; `tp3` is nullable exactly as in V1's `maxR < 1.5` branch. The executable-profile validator therefore requires finite `entry`, `stopLoss`, `tp1`, `tp2`, `risk > 0`, finite `maxR ≥ tp1R`, and `tp3` either null or finite — it must not reject thin-extension candidates. A test asserts a `maxR = 1.2` candidate with `tp3R = null` is accepted and enrolled.

## 12. Closed-candle characterisation gates the flip, not the analysis

Before `v2_enabled` is set true: inspect the last-bar timestamps of H4/H1/M15 from a live fetch against the timeframe boundary and wall clock; document whether the arrays include a forming bar; assert in code and in a test that V1 and V2 receive the *same array reference* from the frozen snapshot; record the finding and its timestamp in `docs/CHARACTERISATION.md` and in the V2 manifest. V1 timing is not modified here — a closed-bar correction, if warranted, becomes model version 3.

## 13. Latency budget

Instrument the job with a duration measurement written to `scan_queue` timing already present (`started_at`/`finished_at`) and compare three states: pre-refactor baseline, refactor with `v2_enabled = false`, refactor with `v2_enabled = true`. Budget: **≤150 ms added p95 with V2 disabled** (observation writes only) and **≤600 ms added p95 with V2 enabled**, against a p95 that must stay under 5 s — well inside the request ceiling. If exceeded: research writes move behind a fire-and-forget path or are dropped for that cycle (the coverage counter records the gap). V1 always has priority under time pressure; no research call is retried inside the job.

## 14. Acceptance tests (failure injections)

1. observation upsert fails ⇒ V1 still publishes, `result = published`, research error counter +1.
2. V2 evaluator throws ⇒ V1 still publishes; observation records `model_error`.
3. cooldown RPC fails ⇒ V1 still publishes; no shadow row.
4. V2 shadow insert fails ⇒ V1 still publishes; observation keeps `candidate` with disposition `none`.
5. disposition update fails ⇒ V1 `JobResult` still exactly correct.
6. two simultaneous V2 claims ⇒ exactly one enrolment.
7. V1 no-trade + V2 candidate ⇒ V2 enrols.
8. V1 cooldown duplicate + V2 candidate ⇒ V2 enrols.
9. V1 23505 duplicate + V2 candidate ⇒ V2 enrols.
10. V1 no-trade + V2 no-trade ⇒ both observations persist.

Plus: frozen-fixture V1 equality (§O of the prior plan — trade/no-trade, grade, direction, entry, SL, TP1–3, `maxR`, pillars, confluence score, structure key), ABC geometry deterministic + property tests, `atrAtIndex` prefix invariance, volatility boundary points, barrier finiteness property test, manifest-hash assertion, and the existing 132-test blocking suite green with `bun run verify` exiting 0.

## 15. Final answers

- **A.** Fully specified executable V2 continuation profile — **YES** (§3 covers every component; nothing left to improvise).
- **B.** Any research DB failure blocking or changing V1 — **NO** (§2, per-call isolation, tests 1–5).
- **C.** Early V1 returns bypassing V2 enrolment — **NO** (§1: single exit, V2 block precedes it; tests 7–9).
- **D.** A/B selection deterministic with no search-until-valid — **YES** (§4).
- **E.** Historical ATR using future candles — **NO** (§6, prefix-invariance test).
- **F.** Every V2 hyperparameter in immutable provenance — **YES** (§8 manifest + hash assertion).
- **G.** Changing a V2 trading rule after observations exist and still calling it V2 — **NO** (§8: requires version 3).
- **H.** V1 math or publication policy changed — **NO** (only copy strings, hoisted-but-identical computations, and the return-into-single-exit restructure, proven by frozen-fixture equality).

## Phasing (unchanged shape)

1. Truthful wording on V1 (Confluence Score not win probability; symmetry diagnostic; displacement-origin zone; B without the false H4 claim; C heuristic/unvalidated) — DB/API field names untouched.
2. Pure V2 modules + tests: `pointc.ts`, `barrier.ts`, `grading.v2.ts`, `atrAtIndex`, volatility transform. Nothing wired.
3. Migration: `model_observations`; `shadow_executions.strategy_family`/`quality_grade`; `v2_structure_claims` + `claim_v2_structure`; `shadow_engine_state.v2_enabled`/`research_errors`/`research_last_error`; `model_versions` row 2 with manifest.
4. Pipeline restructure per §1, shipped with `v2_enabled = false`; latency measured; closed-candle note recorded; then flipped true.
5. Admin research panel: four-cell V1/V2 outcome matrix, V2 shadow stats by family/grade, research error count, observation coverage, V2 open-row age.

`regime_stats`, live priors, promotion and mean-reversion replay remain out of scope. Promotion is a separate prompt.

## Residual risks

Closed-candle status still unverified (gates the flip, not the build); `EXTENSION_ATR = 6` is judgement, flagged as such; at ~30% fill rate, time to a meaningful V1-vs-V2 comparison is plausibly months; `service_role` grants on `shadow_executions` to be confirmed before the insert path is written. Confidence: high on phases 1–3, moderate on phase 4, low that V2 will measurably outperform V1 — no evidence either way yet.
