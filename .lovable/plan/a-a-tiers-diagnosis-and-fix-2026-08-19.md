# A / A+ Tiers: Diagnosis and Fix

## Short answer

They are not "rare markets" — two rules make them structurally near-unreachable. Both were confirmed against the live signal table (88 published signals, 0 A, 0 A+).

## What the data shows

- 19 of 88 signals had full H4 + H1 + M15 trend alignment — the hard part of the A gate is being met regularly.
- All 19 of those were simultaneously flagged "H4 approaching macro resistance", which is the one remaining A condition. Blocked 19/19 times.
- The momentum pillar (required for A+) scored an average of 0.0 across every B-grade signal and passed on only 5 of 88 signals overall.

So: alignment works, and the two gates below veto every candidate.

## Root cause 1 — the macro-barrier rule contradicts the trend rule

The H4 "macro barrier" is the extreme of the last 60 H4 candles, and the A gate requires price to sit more than 2.5 ATR away from it. But when H4 is in a confirmed uptrend, price is by definition at or near its own 60-bar high — so distance is always small. Requiring "H4 aligned" and "H4 far from its own 60-bar extreme" in the same rule is self-cancelling for continuation setups. This is a definition problem, not a market problem.

## Root cause 2 — the momentum pillar asks for the opposite of continuation

The momentum pillar only scores for a long when M15 RSI dips to 40 or below (or bearish-to-bullish divergence). A clean bullish continuation pullback rarely gets oversold, so the pillar reads 0 exactly on the setups A+ is meant to reward. Since A+ = A structure + all four pillars, this alone caps the engine at 3/4 pillars — which matches the observed maximum.

## Proposed fix

Phase 1 — redefine the barrier check (unblocks A)
- Measure room to the *next* opposing H4 structure in the trade's direction (swing high above for longs / swing low below for shorts, using pivot detection), instead of distance to the extreme of the whole 60-bar window.
- Keep the veto only when the trade genuinely has less than 2.5 ATR of headroom to that opposing level, or when the already-computed `maxR` reachability is thin.
- Consequence: A becomes achievable on aligned continuation structures with real room, and stays blocked when price is jammed under resistance.

Phase 2 — rescale the momentum pillar (unblocks A+)
- Score momentum on pullback exhaustion relative to trend, not absolute oversold: RSI returning toward the mid-band from an extreme (e.g. long: RSI dipping into 40-55 then turning up), plus the existing divergence path retained as a full-credit alternative.
- Keep the 70 pass threshold and all four pillar weights unchanged so confidence scores stay comparable.

Phase 3 — validation before anything publishes differently
- Re-run both revised gates in read-only mode over the last 30 days of stored candles/signals and report how many of the 88 historical signals would have graded A and A+.
- Only keep the change if A stays selective (target roughly 10-20% of signals, not a majority). If it floods, tighten the headroom multiple rather than reverting.
- Watch the shadow engine's fill/win split by grade for the following week to confirm A/A+ actually outperform B before treating them as the top tier.

## Technical notes

- `src/lib/scanner/grading.ts`: `readTimeframe` barrier derivation and the `nearMacroBarrier` term in `gradeSetup`; `scoreConfluence` momentum block.
- `src/lib/scanner/profile.ts`: already picks the directional barrier for `maxR`; the A gate must use the same directional logic instead of the H4-bias-derived one.
- No schema change. Grading history stays intact; only newly scanned signals are affected.
- Zero-hallucination rule respected: the validation pass is read-only and writes no rows.
