# Audit: Entry / Stop / Target / Max-R / Dynamic Entry

Plan only. No code, migrations, or DB writes were made. All numbers below come from queries run against the live database this turn.

## 1. Actual goal

Publish only limit setups whose geometry is defensible: an entry a real broker can fill, a stop anchored to the structure that would invalidate the idea, targets that the H4 structure can actually reach, and an honest ceiling on chasing. When any input is missing or degenerate, prefer No Trade.

## 2. Current implementation (re-read at HEAD)

- `src/lib/scanner/profile.ts` builds every published profile: `detectAbc` (V1) → stop from last-10-M15 extreme ± buffer → optional session offset → `evaluate()` risk/reachability → TP ladder → `maxAcceptableEntry`.
- Stop buffer = `max(1.2 × M15 ATR, 0.5 × H1 ATR, static SPREAD_FLOOR[instrument])` (`types.ts`).
- Grade headroom uses `directionalHeadroomAtr` (nearest unbroken H4 pivot, `Infinity` in open space, `grading.ts`); the R cascade uses a **different** barrier, `h4.rangeHigh/rangeLow` (60-bar H4 extreme).
- Ladder: `maxR ≥ 3 → [1,2,3]`; `≥1.5 → [0.5,0.75,1.0]×maxR`; else `[0.6,1.0]×maxR`, TP3 null.
- Slippage: `entry + sign × risk × (maxR < 1.5 ? 0.10 : 0.15)`, mirrored in `db-types.ts` for legacy rows.
- Dynamic entry: only in `london_new_york_overlap`, `0.3 × M15 ATR` behind the detection close, with four guards.
- V2 research (`src/lib/scanner/v2/*`) already fixes Point C (canonical band) and unifies the barrier, publishes nothing.

## 3. Affected surface

`profile.ts`, `grading.ts`, `indicators.ts` (`detectAbc`), `types.ts` constants, `v2/profile.v2.ts`, `v2/barrier.ts`, `pipeline.server.ts`, `alerts.server.ts`, `push.server.ts`, `webhook.server.ts`, `execution/replay.ts`, `db-types.ts`, `SignalCard.tsx`, `signal-alert.tsx`, MCP `list-signals` / `calculate-position-size`, tables `scanned_signals`, `shadow_executions`, `market_context`, `model_observations`, `regime_stats`, `model_versions`.

## 4. Confirmed defects (each verified)

1. **Two different H4 barriers.** Grade can pass on open space (`Infinity` headroom) while targets are capped by the unrelated 60-bar extreme. Live evidence: `max_r` ranges 1.02 → **42.39** (mean 3.89) across 169 signals — a 42R "reachable" extension is not a tradeable claim.
2. **Stop anchor is not the structure.** `slice(-10)` on M15 is a fixed bar count unrelated to the ABC leg; when C is older than 10 bars the anchor is a later, unrelated extreme, so risk and Point C can drift apart across scans of the same leg.
3. **Slippage arithmetic in the comment is wrong.** `types.ts` claims 0.15R turns 1:3 into ~1:2.55. Correct: fill worse by 0.15R gives risk 1.15R and reward 2.85R → **2.478**, not 2.55. The tolerance is also expressed against the *original* risk and never re-derived at the worse fill.
4. **Dynamic entry has never fired.** `scanned_signals` contains **0** rows whose breakdown carries the offset note, and only **1** overlap signal has ever been produced. The feature is untested in production.
5. **Its stated provenance is unsupported.** `types.ts` cites "13% fill in overlap vs 69% in London". Today's resolved shadow set: overlap **n=10, 1 filled**; london n=59, 23 filled (39%); and **89 resolved rows carry a NULL session**. No stored artefact records a sample size, date range, model version, or a comparison of several offsets.
6. **0.3 ATR would barely help.** Of 223 never-filled rows, miss distance p25/p50/p75 = **0.707 / 1.500 / 2.281 ATR**; only **16 (7.2%)** missed by ≤0.3 ATR. A 0.3 ATR offset addresses at most 7% of misses while paying the cost on every fill.
7. **Stale-signal contradiction.** Feed keeps a setup `active` for 24h (`SIGNAL_MAX_AGE_HOURS`) while the card and email tell the user to cancel after 30 minutes (`ORDER_TIF_MINUTES`), and the shadow engine labels fills on the 30-minute rule. Three inconsistent lifetimes for one order.
8. **No broker contract check.** Stop distance is validated only against static `SPREAD_FLOOR`; `stopsLevel`/`minVolume`/tick size from the MetaApi symbol specification are never consulted. FACT to verify: MetaApi exposes symbol specifications via REST; ENGINEERING ASSUMPTION until fetched and logged.

## 5. Hidden / secondary risks

- `maxAcceptableEntry` is duplicated in `db-types.ts`; changing the formula in one place silently diverges the UI from stored rows.
- `evaluate()` re-derives risk per candidate but the stop is computed once — a future stop change must re-enter `evaluate`, else `MAX_RISK_ATR` is bypassed.
- Replay labels fills against `entry_price`; changing entry geometry retroactively changes nothing already stored, but mixing old and new rows in one `regime_stats` cohort would pool two different models. Model versioning is mandatory, not optional.
- `market_context.trading_session` is present for recent rows only; any session-conditioned parameter estimated on the full set inherits 89 unlabelled rows.
- Session is computed twice (pipeline `sessionOf` for context, again for enrolment) — a boundary-straddling cycle can label them differently.

## 6. Alternatives for the dynamic entry

1. **Fixed structural Point C only (drop the offset).** Benefits: deterministic, zero parameters, matches the 7.2% finding. Drawback: leaves overlap fill rate low. Complexity: trivial (delete a branch). Statistical: no overfitting risk.
2. **Keep fixed 0.3 ATR (status quo).** Benefit: already written. Drawbacks: unfalsifiable provenance, pays cost on every fill for ≤7% of misses, and has never once executed — so it is untested code in the publish path.
3. **Regime-conditioned empirical offset** (per instrument × session, estimated from `miss_distance_atr` with a shrinkage prior). Benefit: uses evidence we own. Drawbacks: overlap n=10 cannot support any estimate today; needs the same gates as the learning engine.
4. **Quantile fill-distance model** (offset = q-th percentile of miss distance, e.g. q=0.5 → 1.5 ATR). Benefit: directly targets the miss distribution and is explainable. Drawbacks: 1.5 ATR offsets materially shrink R and change the trade's identity; must be shadow-measured for net expectancy, not fill rate.

**Recommendation:** V1 keeps behaviour but the offset is made inert-by-flag (option 1 semantics in production), and options 3/4 are implemented **only** in V2 research with the cost side (realized R, not fill rate) as the decision metric. Your original framing — treat 0.3 ATR as a hypothesis — is correct, and I reject keeping it live.

## 7. Alternatives for stop and barrier

- **Stop anchor:** (a) status quo last-10 bars; (b) **leg-scoped extreme between B's bar and the C bar** (recommended — that is the structure the idea depends on); (c) swing-pivot-only anchor (rejected: ignores wick excursions the market already made).
- **Barrier:** (a) status quo dual definition; (b) **V2 canonical single barrier with a bounded open-space extension** (recommended — kills the 42R artefact and makes grade and R agree).
- **Spread/stops floor:** (a) static table (status quo); (b) **broker-derived floor with fail-closed No Trade when the specification is unavailable** (recommended, subject to verifying the REST field names before implementing).

All three land in V2 research first; none silently change V1.

## 8. Mathematical corrections to adopt

For entry `E`, stop `S`, risk `R = |E − S|`, worse fill `E' = E + s·tR`:
- actual risk `R' = R(1 + t)`; reward to a target at `kR` becomes `R(k − t)`; realised ratio `= (k − t)/(1 + t)`.
- t = 0.15, k = 3 → **2.478** (not 2.55). t = 0.10, k = 1.02 → 0.836.
- Ceiling definition to adopt: the largest `t` such that `(k_final − t)/(1 + t) ≥ RR_min`, solved as `t ≤ (k_final − RR_min)/(1 + RR_min)`, so the ceiling is derived from a stated minimum acceptable payoff instead of a bare constant. Both the scanner and `db-types.ts` read one shared function.

## 9-11. Schema / backend / frontend changes

- **Schema:** no change to V1 columns. Add nullable research columns on `shadow_executions` for V2 entry/stop provenance (`entry_source`, `stop_anchor`, `offset_atr`) plus grants unchanged; register a new `model_versions` row (v3 research) when the corrected geometry differs from v2's parameter hash. No backfill, no rewrite of historical rows.
- **Backend:** one shared slippage module used by scanner, UI and MCP; V2 profile gains leg-scoped stop, broker-spec floor (fail-closed), and the offset experiment behind `shadow_engine_state.v2_enabled`; align the order lifetime so feed status, card copy, email and replay all read `ORDER_TIF_MINUTES` from one source.
- **Frontend:** correct the slippage explanation in `SignalCard`/emails to the re-derived ratio, and stop telling users to cancel in 30 minutes while the feed still shows the setup as live for 24 hours.

## 12-15. MCP / history / security / performance

MCP `list_signals` and `calculate_position_size` inherit whatever the shared slippage function returns — no tool contract change. Historical observations are never rewritten; comparison happens across model versions. No RLS or grant change is needed (research tables stay service-role only). Added work is one extra symbol-specification fetch per instrument per cycle, cached per run, inside the existing 8s timeout budget; p95 scan latency stays the acceptance metric.

## 16. Implementation sequence

1. Capture the baseline (section 19) and pin it in `baseline_snapshots`.
2. Extract the shared slippage module + correct the arithmetic and the copy (no geometry change).
3. Unify the order lifetime.
4. Flag the dynamic offset inert in V1; record it as a hypothesis in the model manifest.
5. V2 research: leg-scoped stop, single barrier already present, broker-spec floor with fail-closed.
6. V2 offset experiment (options 3/4) measured on realised R.
7. Tests (section 17) before enabling anything.
8. Compare, then promote only on explicit approval.

## 17. Test matrix (concrete)

- Slippage unit: `E=1.1000, S=1.0980, R=0.0020, k=3, t=0.15` → ceiling `1.10030`, realised ratio `2.478`. Short mirror: `E=1.1000, S=1.1020` → `1.09970`.
- Ladder: `maxR=1.02` → `[0.61, 1.02, null]`; `maxR=1.6` → `[0.8, 1.2, 1.6]`; `maxR=3.4` → `[1,2,3]`.
- Barrier invariant (property): grade headroom and R-cascade barrier are the same price for every generated candle set; `maxR` finite always; `maxR ≤ OPEN_SPACE_EXTENSION_ATR × H4ATR / risk`.
- Stop: leg-scoped anchor equals last-10 anchor when C is the recent extreme, and differs (test asserts the leg anchor) when C is 14 bars back.
- Malformed: NaN/zero-range candles, single candle, stop == entry, barrier behind entry → No Trade, never a published row.
- Broker spec: specification unavailable → No Trade (fail-closed), asserted, not defaulted.
- DB/RLS: V2 rows never appear in feed queries; V1/V2 cohorts isolated in `regime_stats`.
- Failure injection: MetaApi timeout, duplicate scan job, concurrent claim of the same structure, partial insert after signal row, stale run id.

## 18. Baseline to capture (data availability stated honestly)

Available now: 169 signals (2026-08-11 → 08-21); grade mix A 3 / B 235 / C 73 on resolved shadow rows; direction 154 long vs 15 short; fill rate 88/311 resolved (28.3%); never-filled 223; miss-distance quartiles above; `max_r` mean 3.89 / max 42.39; 30 signals with maxR < 1.5.
**Not calculable today:** any session-conditioned offset estimate (overlap n=10, 89 rows unlabelled), and any V2 fill/win comparison (`shadow_executions` has **0** resolved rows at model_version 2). I will not fabricate those numbers; the plan gates promotion on them.

## 19-21. Comparison, deployment, rollback

V1 continues publishing untouched. Corrected geometry runs as a new research model version alongside v2, enrolled in the shadow engine only. Promotion requires: ≥150 resolved research rows, fill rate and mean R both non-inferior to V1 in the same sessions, and no increase in never-filled at equal R. Kill switches: `shadow_engine_state.v2_enabled` for research enrolment, and the offset flag for entry geometry. Rollback is flag-flip plus a forward-fix migration; research columns are additive and nullable, so no collected data is destroyed.

## 22. Acceptance criteria

Shared slippage function with re-derived arithmetic and matching copy; one order lifetime everywhere; no V1 signal, grade, entry, stop, target or alert changes in the same deploy; V2 research emits provenance-stamped rows; full test matrix green; baseline snapshot pinned before any behaviour change.

## 23-24. Uncertainties and what I cannot guarantee

Open: exact MetaApi symbol-specification field names and availability per instrument (must be probed before step 5); whether a leg-scoped stop widens risk enough to reduce publish volume; whether any offset improves expectancy at all. I cannot guarantee that corrected geometry increases fill rate or expectancy, that overlap will produce enough samples in a useful timeframe, or that historical labels remain comparable if broker feed history is revised.

## 25. Recommendation

Proceed with this plan, with two explicit modifications to your framing: the dynamic 0.3 ATR offset should be made inert in V1 rather than preserved as live behaviour (it has never fired and the miss distribution does not support it), and the stop/barrier corrections belong in a versioned research model rather than a live edit.
