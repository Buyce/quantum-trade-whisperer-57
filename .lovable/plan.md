# Red-Team Review of the Entry/Stop/Target/Max-R/Offset Audit Plan

Independent second-pass review of the proposed plan. No code, migrations, or DB writes made; all figures below are live queries from this turn.

## A. Plan defects discovered

1. **The plan contradicted itself on versioning.** It both said "V1 behaviour unchanged" and recommended "make the 0.3 ATR offset inert in V1." Inerting the offset changes V1 entry geometry for overlap setups. Since the user's standing rule is *current production model + corrected model in shadow → promote on evidence*, the correct move is to leave V1's live offset exactly as-is and do any offset work only as V2 research. Keeping V1 frozen is what makes `scanned_signals`/feed/MCP/alert baselines comparable.

2. **Selection bias in the miss-distance evidence.** The "7.2% of misses ≤0.3 ATR" figure is estimated only from `never_filled` rows (n=223). Filled rows never miss by definition, so this quantile is an upper-bound, ex-post distribution and **cannot** support a fill-rate improvement claim. A 0.3 ATR offset is a volume-side lever: it trades larger risk for more fills. Its merit must be judged on net expectancy, measured by a shadow A/B, never from the miss distribution of non-fills alone. Same applies to the "13% vs 69%" note in `types.ts` — current resolved data shows overlap 1/10 (10%) and London 23/59 (39%), and 89 rows carry a NULL session, so neither cited rate is reproducible from the stored set.

3. **Lookahead/overfitting trap in the options section.** Option 3/4 estimated offsets *from* historical `miss_distance_atr` (post-detection outcomes) and then proposed using them live. Fitting a parameter on the data that labels it is overfitting. Any offset candidate must be treated as a hypothesis, A/B-tested in the shadow engine, and only then considered.

4. **"Slippage ceiling re-derivation" is a behaviour change, not a doc fix.** Replacing the static 0.15R tolerance with a target-preserving formula changes stored `max_acceptable_entry`, which drives the execution chip in `SignalCard` and the "do not enter at market" copy in `signal-alert.tsx`. It is not copy-only. It must be a versioned V2 change, or shipped as a documented recalculation with a fresh `model_versions` hash.

5. **Order-lifetime "contradiction" was misread.** `ORDER_TIF_MINUTES=30` governs the pending-order window and the replay fill test (`replay.ts:107`). `SIGNAL_MAX_AGE_HOURS=24` and grade `RETENTION_HOURS` govern how long the feed keeps a signal row visible/expires it (`expireStaleSignals`). These are different concerns — order TIF vs. feed retention — not a bug. "Unifying" them would change feed retention and dedup behaviour. Retracted.

6. **Broker `stopsLevel` is marked unverified, yet the plan leaned on it as an anchor.** The exact MetaApi REST field names/availability per instrument are unconfirmed. Fail-closed is correct, but the plan must not present the broker floor as a solved input.

7. **The plan's rollback claim ("additive, so reversible") is only true if V1 stays frozen.** Any live geometry change (offset, ceiling, stop anchor) is only reversible via feature flags + a fresh model version, not by an additive migration alone. This is now explicit.

## B. Revised plan

Principle: **V1 is frozen. Every geometry correction becomes a versioned V2 research change, measured against the frozen V1 baseline in the shadow engine. Only copy that is mathematically wrong is fixed in place.**

1. **Baseline first (unchanged).** Capture and pin in `baseline_snapshots` the frozen-V1 metrics: signal count/grade/direction/instrument/session mix, fill rate (currently 88/311 resolved, 28.3%), never-filled rate, win-if-filled, mean R, `max_r` mean 3.89 / max 42.39, miss-distance quartiles, p95 scan latency, alert/webhook counts, duplicate-suppression rate. State explicitly which numbers are unavailable (any session-conditioned estimate; all V2 outcomes — `model_version=2` has **0** resolved rows).
2. **Correct the wrong copy only.** `types.ts` and `SignalCard`/email text that state 0.15R turns 1:3 into ~1:2.55 are wrong; the correct realised ratio is `(k−t)/(1+t) = 2.478`. Fix the text and the comment. Store values are untouched, so no behaviour or MCP contract changes.
3. **Document the V1 offset as a hypothesis.** No code change. Record in the V2 manifest that the live 0.3 ATR offset is unvalidated (never fired — 0 overlapping signals carry the offset note; 1 overlap signal total; cited fill stats unreproducible).
4. **V2 research changes** (all gated behind `shadow_engine_state.v2_enabled`, `model_version=2`, never written to feed/MCP/alerts):
   - **Leg-scoped stop anchor**: extreme between B's bar and C (or B→current) instead of `slice(-10)`.
   - **Single canonical barrier**: reuse `v2/barrier.ts` (already at HEAD) so grade headroom and the R cascade share one definition; bounded open-space extension removes the 42R artefact in V2 only.
   - **Slippage ceiling re-derivation** as a target-preserving formula with a stated minimum acceptable payoff, only in V2.
   - **Offset experiment**: fixed structural entry vs. fixed 0.3 ATR vs. quantile fill-distance candidate, A/B-tested in shadow on **net expected R**, not fill rate. A candidate is promoted only if its net R is non-inferior to V1 in the same sessions at equal or better risk control.
   - **Broker-spec floor**: fetch symbol specification per instrument per cycle (cached), fail-closed to No-Trade when unavailable. Verify REST field names before relying on them.
5. **Tests** (all blocking) before any research enablement: slippage arithmetic (`E=1.1000,S=1.0980,R=0.0020,k=3,t=0.15` → ceiling `1.10030`, ratio `2.478`; short mirror → `1.09970`); ladder (`maxR=1.02→[0.61,1.02,null]`, `1.6→[0.8,1.2,1.6]`, `3.4→[1,2,3]`); barrier invariant grade==R source and finite bounded `maxR`; leg-scoped stop differs from last-10 when C is old and equals it when C is the recent extreme; malformed/NaN/single-candle/zero-risk/barrier-behind-entry → No Trade; broker-spec unavailable → No Trade (fail-closed); V2 rows unreachable from feed/MCP/alerts; V1/V2 cohorts isolated in `regime_stats`; MetaApi timeout, duplicate job, concurrent claim, partial insert, stale run id.

## C. New acceptance criteria

- V1 signal/entry/stop/target/grade/ceiling/feed-retention/dedup/alerts produce byte-identical outputs before vs. after the deploy (frozen-model regression on a pinned candle set).
- Wrong 0.15R→2.55 copy is corrected everywhere to 2.478.
- V2 research writes provenance-stamped (`entry_source`, `stop_anchor`, `offset_atr`) shadow rows only; 0 resolved V2 rows as of baseline are acknowledged and not backfilled or fabricated.
- Offset candidates are reported on net R with sample sizes and significance; no promotion without ≥150 resolved research rows and non-inferior net R in matched sessions.
- Full test matrix green; no live alert, push, email, webhook or MCP payload changes.

## D. Remaining risks

- Broker-spec field availability unverified; V2 stop/ceiling may change publish volume in research (expected, not a regression — V1 is frozen).
- Overlap data is structurally scarce (n=10) and may not yield a statistically usable comparison for months; the offset question may stay undecided, which is an acceptable honest outcome.
- Two different R-measurement paths (shadow replay vs. user-reported) can disagree; this is a pre-existing condition, not introduced here.
- Fixing copy without touching values risks a future reader re-introducing the wrong formula.

## E. Confidence level — High (approx. 0.85)

Reasons: the plan now aligns with the established frozen-V1/versioned-shadow rule; the versioning contradiction, selection bias, lookahead and misread-TIF defects were found and removed; every behavioural change is gated, additive and reversible by flag-flip; concrete numeric fixtures exist for the mathematics. Remaining uncertainty is concentrated in broker-spec availability and in sample scarcity, both acknowledged rather than assumed away.

## F. What still cannot be guaranteed

- That any corrected geometry (stop anchor, offset, ceiling) improves fill rate or net expectancy — the data does not exist to promise this, and V1 stays unchanged precisely so this can be measured rather than assumed.
- That the overlap regime produces enough shadow samples in any useful timeframe.
- That historical V1 labels remain comparable if the broker feed history is revised.
- That broker `stopsLevel` is surfaced identically across all three instruments (unverified until probed).

Verdict: **proceed with the revised plan** — the corrected geometry in V2 research, frozen V1, honest baseline, and wrong-copy fix in place. No implementation begins until you approve this revised plan.
