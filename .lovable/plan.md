# Grading Redesign After Canonical ABC — Audit and Plan (PLAN ONLY)

## 1. Actual goal

Make the grade a user can read mean exactly one thing: a named strategy with a boolean entry rule, plus a quality tier inside that strategy. Today "A/B/C" mixes two different trading theories with a quality ladder, and the headline "Confidence %" is not a probability. Nothing about live trading behaviour changes in this prompt.

## 2. Current implementation (re-read at HEAD)

- `readTimeframe` (grading.ts): bias needs EMA20>EMA50>EMA200 plus price above EMA20. **`slow = ema(closes,200) ?? ema(closes,100)`** — a silent definition change when H4/H1 history is short. `barrier` = extreme of the last 60 bars. `atPointC` = price inside `legMid ± 0.75·ATR` of that 60-bar range — a proxy that is unrelated to the ABC `c` swing computed later.
- `gradeSetup`: `A` = all three aligned AND (`m15.atPointC || h1.atPointC`) AND headroom ≥ 2.5 ATR. Then `else if (h1m15Aligned && nearMacroBarrier) B; else if (h1m15Aligned) B;` — two branches, identical result, **H4 never constrains B**. `else if (m15.bias !== 'neutral') C` — C is only "M15 is directional", no mean-reversion condition at all.
- `directionalHeadroomAtr`: nearest **unbroken H4 swing pivot** ahead of price (fractal 5, 0.3 ATR noise band), `+Infinity` when clear.
- `profile.ts` `evaluate()`: reachability uses **`h4.rangeHigh/rangeLow`** — the 60-bar extreme, *not* the pivot barrier used for the A gate. Two different "H4 barrier" definitions drive grade vs `maxR`, `tp1..tp3`, `capped`, wording.
- `A+` = graded A with `pillars.passed === 4`; strict superset of A. No A+ has ever been published.
- `scoreConfidence`: weighted pillars (35/25/20/20) × `clamp(rr/2, 0.7, 1)`. `symmetry` is **returned in the breakdown but never enters `score`**. `rr` field is computed and also unused in `score`.
- Pillar 2 (`detectOrderBlocks`): displacement body/ATR ≥ 1.2 with a 10-bar structure break; `displacementAtr` uses **current ATR of the whole series**, not ATR at formation; H1/H4 zone distance is normalised with **M15 ATR** (`zoneDistanceAtr(b, pointC, input.m15Atr)`).
- Pillar 4: `ratio <= 0 → 0`, `ratio >= 1 → 80 + (ratio-1)·100`, else `ratio·60`. At ratio 0.999 → 59.9 (fail), at 1.000 → 80 (pass): a **20-point step across the pass line**.
- Consumers of grade/confidence: `pipeline.server.ts`, `alerts.server.ts` (`alert_min_grade`, cap exempting C), `push.server.ts`, `webhook.server.ts`, `email-templates/signal-alert.tsx`, `weekly.ts` (A/A+ vs B/C cohorts), `regime_stats`/`shadow_executions`, `signal-audit.functions.ts`, `admin.functions.ts`, `baseline/capture.server.ts`, MCP `list_signals` (`GRADE_RANK`), `SignalCard.tsx`, `feed.tsx`, `performance.tsx`, `settings.tsx` (`min_grade`, `alert_min_grade`), `index.tsx` marketing copy, `signal_grade` enum in the DB.

## 3. Confirmed defects

| # | Defect | Evidence |
|---|---|---|
| D1 | B has no H4 constraint despite the card saying "H4 context caps the extension" | duplicate `h1m15Aligned` branches |
| D2 | C is "M15 directional", not mean reversion; card claims "mean-reversion only" | `else if (m15.bias !== 'neutral')` |
| D3 | EMA200 silently degrades to EMA100 | `ema(...,200) ?? ema(...,100)` |
| D4 | Two Point C definitions (grading proxy vs `detectAbc.c`) | grading.ts vs profile.ts |
| D5 | Two H4 barrier definitions (pivot for grade, 60-bar extreme for R) | `directionalHeadroomAtr` vs `evaluate` |
| D6 | Displacement normalised by current ATR, H1/H4 zones by M15 ATR | `detectOrderBlocks`, `zoneDistanceAtr` call |
| D7 | Volatility score discontinuity of 20 points at ratio 1.0 | pillar 4 formula |
| D8 | Symmetry displayed as a score component but has zero effect | `scoreConfidence` |
| D9 | "Confidence %" is not calibrated: observed mean confidence 42.9 vs observed win-if-filled ≈ 0.50 | measured, §19 |
| D10 | Four pillars all derived from the same OHLC series are summed as if independent confirmation | by construction |

## 4. Hidden risks found

- **Grade population is degenerate**: 142 of 160 signals are B, 3 are A, 15 are C, 0 A+. Any B redefinition changes almost the entire product surface, `alert_min_grade` defaults, the weekly A/A+ vs B/C report and every `regime_stats` bucket.
- 148 of 160 signals are long; instrument spread is even. Direction skew makes per-grade comparisons weak.
- `alerts.server.ts` exempts C from the daily cap and `weekly.ts` groups C with B. Removing or renaming C changes cap arithmetic and report cohorts, not just labels.
- `signal_grade` is a Postgres enum used by `scanned_signals`, `shadow_executions` and `scanner_settings.min_grade`/`alert_min_grade`. Adding a value is safe; removing one is not.
- `regime_stats` tiers key on instrument/direction/session/vol only — a strategy_family split needs a new key dimension or the two families pool into one prior (statistically invalid).
- `structureKeyOf` dedup depends on stop price; changing the stop or Point C definition invalidates cooldown continuity and can re-publish "old" structures once.

## 5. Alternatives

**(A) Patch grades in place (fix D1/D2 inside the current A/B/C ladder).** Cheap, no schema change. Rejected: it keeps one axis carrying two theories, still leaves C undefined, and silently changes the live model — 24 H4-neutral B signals per ~10 days stop existing with no shadow comparison.

**(B) Strategy family + quality grade (recommended, shadow-first).** `strategy_family ∈ {continuation, mean_reversion}` × `quality_grade ∈ {A+, A, B}`. Continuation requires H4 alignment by definition, so D1 disappears structurally. Mean reversion becomes a real, separately defined strategy — and stays **research-only (never published)** until it has its own resolved sample. Cost: new columns, family-aware regime keys, UI/MCP/report changes, and a V2 shadow engine. This is the only option that satisfies "no silent model change".

**(C) Keep A/B/C, disable C, add `A++`-style tiers.** Rejected: renaming does not fix that B and C encode different theories, and it discards the mean-reversion idea instead of testing it.

**Volatility transform:** continuous piecewise-linear (0 at ratio 0, 60 at 1.0, 100 at 1.6, flat above) — removes the step, keeps the current pass line interpretable. Logistic and percentile/rank regime are *research-only* candidates; with 302 resolved shadow rows there is no evidence to prefer a fancier transform, and percentile requires per-instrument history the scanner reads per cycle. Boolean threshold rejected: it throws away magnitude the EV model already uses.

## 6. Recommended architecture

1. **V1 stays untouched and keeps publishing.** No change to `scanned_signals` writes, alerts, webhooks, risk or replay semantics.
2. **V2 grading engine, shadow only** (`model_version = 2`, `shadow_executions.signal_id = NULL`, no `scanned_signals` insert), sharing the same in-memory candles per scan cycle and the same `observation_key` so every V1/V2 difference is attributable to logic, not data. V2 contains: canonical barrier, canonical Point C, EMA200-or-insufficient-data, native-TF ATR normalisation, continuous volatility, family/grade taxonomy.
3. **Promotion is explicit** and a separate prompt, gated on §22.
4. **Naming/labelling changes that are pure presentation ship immediately** (§11), because they make *current* V1 wording true rather than changing behaviour.

### V2 definitions

- **Insufficient data** (fail-closed, no trade, no shadow row): fewer than 200 closed candles on H4 or H1, `atr === 0` on any timeframe, malformed OHLC.
- **Canonical directional barrier** `B_dir`: nearest unbroken opposing H4 fractal-5 swing pivot ahead of price (existing `directionalHeadroomAtr` logic), `+Infinity` when none. Used for headroom, `maxR`, target scaling and wording — one definition, three uses.
- **Canonical Point C**: `detectAbc(M15, direction).c` with retracement ∈ [0.382, 0.886]; the `legMid ± 0.75 ATR` proxy is deleted from V2.
- **continuation / A**: H4=H1=M15 aligned non-neutral, price at canonical C, headroom ≥ 2.5 ATR, retracement in window.
- **continuation / A+**: A **and** all four pillars ≥ 60 (strict superset, unchanged shape).
- **continuation / B**: H4 aligned and H1=M15 aligned, but exactly one of {at C, headroom ≥ 2.5 ATR} fails. **H4 alignment is mandatory** — H4-neutral or H4-opposed is no longer a B.
- **mean_reversion / research-only**: H4 neutral or opposed, M15 directional *against* H1, price beyond a 2.0-ATR extension from the H1 EMA50 with an RSI extreme (≤30 / ≥70) and an opposing displacement-origin zone within 0.5 native ATR. Never published; shadow only.
- Everything else: **no trade** (today's "C" catch-all is removed as a production output).
- **Confluence Score 0–100** replaces "Confidence %" everywhere in wording. Symmetry either enters the score explicitly (V2 candidate weight) or is displayed as an unweighted diagnostic labelled *heuristic, not scored* — the plan ships the label now and tests the weight in V2.
- **Displacement-origin supply/demand zone** replaces "institutional order block" in all copy. Displacement normalised by `atrSeries[i]` at formation; zone distance normalised by the **zone's own timeframe ATR**.

## 7. Truth table (V2, `bias` from the EMA stack)

| H4 | H1 | M15 | at C | headroom ≥2.5 | 4 pillars | Output |
|---|---|---|---|---|---|---|
| bull | bull | bull | yes | yes | yes | continuation A+ |
| bull | bull | bull | yes | yes | no | continuation A |
| bull | bull | bull | no | yes | – | continuation B |
| bull | bull | bull | yes | no | – | continuation B |
| bull | bull | bull | no | no | – | no trade |
| bear | bear | bear | mirror of the four rows above | | | mirrored |
| neutral | bull | bull | – | – | – | no trade (was B today) |
| bull | neutral | bull | – | – | – | no trade |
| bull | bull | neutral | – | – | – | no trade |
| bull | bull | bear | – | – | – | no trade (continuation), mean_reversion candidate |
| bear | bear | bull | – | – | – | no trade, mean_reversion candidate |
| neutral | neutral | bull/bear | – | – | – | no trade (was C today) |
| any with EMA200 unavailable | | | | | | insufficient data → no trade |

## 8. Technical detail

- Volatility: `v(r) = 0` for r ≤ 0; `60·r` for 0 < r ≤ 1; `60 + (r−1)/0.6·40` for 1 < r ≤ 1.6; `100` above. Continuous at r=1 (60) and r=1.6 (100). Removes the 20-point jump; pass line stays at 60 ⇒ r ≥ 1.0, i.e. **the current pass/fail set is preserved** while the score becomes continuous.
- Pillar aggregation stays a weighted average and is documented as a **heuristic confluence index, not a probability**; pillars are correlated OHLC transforms, so no independence claim and no probability multiplication. Probability of win remains the job of `regime_stats` shrinkage, which is fit on outcomes.
- A future calibrated probability model is a separate prompt: logistic regression on the pillar vector, fit only on out-of-sample resolved shadow rows, judged by Brier score and a reliability curve, minimum ~400 filled resolutions per family.

## 9–12. Schema / backend / frontend / MCP

- **Schema (additive only, one migration):** `strategy_family text` and `quality_grade text` on `scanned_signals` and `shadow_executions` (nullable, no default), CHECK on allowed values, plus `strategy_family` in `regime_stats`/`regime_snapshots` keys and in `recompute_regime_stats` grouping so families never pool. No enum value removed, no column dropped, no historical row rewritten. GRANTs unchanged (columns inherit table grants).
- **Backend:** new `src/lib/scanner/grading.v2.ts`, `barrier.ts` (canonical `B_dir`), `pointc.ts`; `indicators.ts` gains `atrAtIndex`; pipeline gains a V2 evaluation step writing only `shadow_executions (model_version=2, signal_id NULL)` behind a kill switch. V1 files are not edited except where noted below.
- **Frontend (wording only, this prompt's shippable part):** "Confidence" → "Confluence Score", "Order block retest" → "Displacement-origin zone", symmetry labelled heuristic/unscored, B card copy corrected to stop claiming an H4 constraint V1 does not enforce, C card copy corrected to stop claiming mean reversion. Landing-page copy updated to match.
- **MCP:** `list_signals` keeps `min_grade` with `GRADE_RANK` for V1; when V2 promotes, add optional `strategy_family` filter and expose `quality_grade`; keep the old field populated for one deprecation window. `get_intelligence`/`get_shadow_comparison` gain family breakdowns.

## 13–15. Versioning, security, performance

Historical rows keep `model_version = 1` and are never relabelled; `strategy_family` is backfilled **only** as a derived read-time view for reporting, never written over V1 rows. No new secret, no new public route, no RLS relaxation; `shadow_executions` stays server-only. Cost: one extra grading pass per instrument per cycle on candles already in memory (no extra MetaApi calls, no extra broker traffic), plus ~3 rows/cycle in `shadow_queue`.

## 16. Sequence

1. Ship wording/labelling corrections (§11) — no behaviour change.
2. Capture the V1 baseline snapshot (§19) via the existing `baseline_snapshots` path.
3. Additive migration (§9).
4. `barrier.ts` / `pointc.ts` / `grading.v2.ts` + unit and property tests.
5. Pipeline V2 shadow branch behind `SHADOW_V2_ENABLED` kill switch.
6. Family-aware `recompute_regime_stats`; admin panel V1-vs-V2 comparison.
7. Accumulate samples; no promotion in this prompt.

## 17. Test matrix (concrete fixtures)

- **Truth table**: 13 synthetic candle sets, one per §7 row, asserting exact family/grade/no-trade.
- **EMA fail-closed**: 199 H4 candles → `insufficient_data`, no shadow row, no signal (V1 pin remains: it silently uses EMA100).
- **Volatility continuity** (property, fixed seed): `|v(r) − v(r+1e-6)| < 0.01` for r ∈ (0, 3); `v(0.999) ≈ 59.94`, `v(1.0) = 60`, `v(1.3) = 80`, `v(1.6) = 100`, `v(2.5) = 100`.
- **Barrier consistency** (invariant): for every published profile, `maxR·risk ≤ |B_dir − entry|` and the grade's headroom uses the same `B_dir`.
- **Point C**: long, A=1.1000 B=1.1100 C=1.1045 → retracement 0.55, in window; C=1.1095 → 0.05, rejected; C=1.0980 → 1.20, rejected.
- **R geometry** (hand-calculated): long entry 1.1000, stop 1.0950 ⇒ risk 0.0050; barrier 1.1200 ⇒ `maxR = 4.0` ⇒ TPs at 1.1050/1.1100/1.1150. Short entry 1.1000, stop 1.1050, barrier 1.0850 ⇒ `maxR = 3.0`.
- **Zone normalisation**: an H4 zone 30 pips from C with H4 ATR 60 pips and M15 ATR 10 pips scores 0.5 ATR (V2) vs 3.0 ATR (V1) — pinned as an intentional divergence.
- **Malformed**: high < low, NaN close, non-monotonic timestamps, zero ATR ⇒ no trade, no NaN anywhere.
- **DB/RLS**: family columns keep V1/V2 cohort isolation; `recompute_regime_stats(1)` untouched by family rows; `anon` still denied on `shadow_executions`/`baseline_snapshots`.
- **Failure injection**: MetaApi timeout/401/429 mid-cycle ⇒ V1 unaffected, no V2 row; duplicate worker invocation ⇒ one claim; V2 throw ⇒ caught, V1 publish still commits (V2 must never be able to block a V1 signal).
- **Regression**: replay the current 302 resolved shadow rows through V1 code and assert byte-identical grades — proof V2 work changed nothing live.

## 18–19. Baseline (measured now, not fabricated)

Signals: **A 3, B 142, C 15, A+ 0** (160 total, 2026‑08‑11 → 08‑21). Direction: 148 long / 12 short. Instruments: XAUUSD 58, GBPAUD 53, EURUSD 49. Shadow: 302 rows, 295 resolved, **210 never-filled (≈30% fill)**. Win-if-filled: B 0.500 (mean R −0.013), C 0.444 (−0.013), A 1.000 on n=1 filled. B split by H4: H4-aligned n=118 (33 filled, win 0.545), **H4-neutral n=24 (7 filled, win 0.429)**. Pillar means: trend 78.8, order block 10.5, momentum 18.8, volatility 62.8, symmetry 49.7, confluence 42.9 (range 18.4–76.2); only 12 of 160 signals passed the order-block pillar.

**Statistical verdict: the H4-neutral-B hypothesis cannot be tested with 7 filled samples, and A/A+ has no baseline at all.** The baseline is therefore descriptive (distributions, fill rate, pillar means, latency, dedup counts, alert counts, risk-calculator outputs on fixed inputs) and the promotion decision waits for the shadow sample.

## 20–21. Deployment and rollback

V2 ships disabled, enabled by kill switch, and can only ever write `shadow_executions`. Rollback = flip the switch off (behaviour) or `delete from shadow_executions where model_version = 2` (data); the additive migration reverts by dropping the new nullable columns, and V1 rows are untouched either way. No forward migration rewrites history.

## 22. Acceptance criteria

Wording changes contain no claim V1 does not enforce; truth table fully covered by passing tests; barrier used identically for grade and R; zero V1 output diff on the 302-row regression replay; V2 rows carry `model_version = 2` and `signal_id NULL`; no published signal count/grade change; `bun run verify` green. Promotion is out of scope.

## 23–24. Uncertainties and what cannot be guaranteed

Unverified: whether H4-aligned B genuinely outperforms H4-neutral B (n=7 filled); whether mean reversion has any edge; whether the smooth volatility transform improves EV at all. Cannot guarantee: that removing H4-neutral B and C will not sharply reduce signal volume (on current data it removes ~24% of signals); that shadow replay equals broker execution; that 30% fill rate improves; that the redesign raises win rate rather than only making the labels honest.

## 25. Recommendation

**Proceed with option (B), shadow-first** — plus the immediate wording/labelling corrections, which are the only part that touches production this prompt. I explicitly reject patching grades in place: it would silently change the live model on evidence that does not exist yet.
