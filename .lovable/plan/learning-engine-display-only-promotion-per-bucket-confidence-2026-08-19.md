# Learning Engine — Display-Only Promotion + Per-Bucket Confidence Floor

Two changes, both confined to how the Bayesian priors are _selected_ and _presented_. Grading, alert fan-out, entry pricing, the daily cap and the webhook payload stay untouched — no trade is placed, blocked or repriced by the learning engine after this work.

## Part 1 — Per-bucket confidence floor

Today a tier-3 (exact regime: instrument + direction + session + volatility bucket) row answers the lookup however small it is. Some live buckets hold only a handful of resolved samples, so the panel can show a confident-looking regime read built on almost nothing.

- Add a minimum resolved-sample floor of **20** for tier-3 rows.
- A tier-3 bucket below the floor is skipped and the lookup falls back to tier 2 (instrument + direction), then tier 1 (global) — the same honest-fallback chain that exists now, just entered earlier.
- The model-explain drawer reports when a fallback happened because the exact bucket was under the floor, and names the sample count it had. It never hides the reason.

Shrinkage stays exactly as it is (k = 30, computed in SQL). The floor governs _which tier is allowed to speak_, not the maths.

## Part 2 — Display-only promotion at the fill gate

The fill gate clears at 150 resolved shadow samples (currently 147). When it clears, the priors get promoted in the UI only.

**Fix a real defect first.** The signal card currently checks the win gate against the _resolved_ sample count instead of the _filled_ count, so once resolved passes 200 the win rate would be wrongly labelled active while sitting on far fewer filled samples. Each published signal will store the filled-sample count and the tier that answered, alongside the resolved count it already stores, so both gates are evaluated against the right denominator.

**Intelligence Panel changes**

- Per-metric status instead of one blanket "advisory" label: fill rate reads `Active` once its gate is clear; win rate keeps reading `Learning — 47/200 filled` until its own gate clears.
- The tier that answered is shown ("This exact regime", "Instrument + direction", "All instruments") with its sample size, so a global fallback is never mistaken for a specific read.
- The standing disclaimer stays on the card in every state: these rates do not place, block or reprice trades.

**Expected-value ranking on the feed**

- The collapsed signal summary row gains an expected-value figure (P(fill) x P(win)) once the fill gate is clear, so the ordering is legible without expanding a card.
- The Filters popover gains a sort choice: **Newest first** (default, unchanged) or **Expected value**. Choosing expected value reorders the rendered list client-side only.
- Signals with no prior (or a prior below the floor at every tier) sort last under expected value and show an em dash rather than a substituted number.

## Zero-hallucination guarantees

- No backfill of the new per-signal fields onto historical rows — older signals show the tier/filled counts as unknown and keep their current advisory labelling.
- Empty `regime_stats`, a null prior, or a bucket under the floor all render as an absent panel or an em dash. Nothing is invented to fill the slot.
- No seeding, no synthetic regimes, no placeholder probabilities.

## Technical notes

- Migration: add `prior_filled_n integer` and `prior_tier smallint` to `scanned_signals` (nullable, no default, no backfill). No new table, no policy change.
- `src/lib/learning/regime.ts`: export `MIN_N_TIER3 = 20`; `lookupRegime` filters tier-3 candidates by `n_total >= MIN_N_TIER3`; `RegimePrior` already carries `tier` and `filledN`, so gate evaluation moves onto `filledN` for the win gate.
- `src/lib/learning/explain.ts`: surface the skipped-bucket reason and its sample count in the shrinkage ladder.
- `src/lib/scanner/pipeline.server.ts`: stamp `prior_filled_n` and `prior_tier` from the same `priorFor()` result already in scope — one added field pair on the existing insert, no extra query.
- `src/lib/queries.ts`: add the two columns to the signal select list.
- `src/components/SignalCard.tsx`: `IntelligencePanel` per-metric gate labels + tier line; summary row expected-value figure.
- `src/routes/_authenticated/feed.tsx`: sort control in the Filters popover, client-side ordering only.
- `src/components/LearningHistory.tsx`: note the tier-3 floor next to the existing gate counters.
- Verification: unit-check `lookupRegime` fallback behaviour against the live `regime_stats` rows (46 buckets, global n = 147 / 47 filled), confirm a below-floor tier-3 bucket falls back and that the panel labels match the real counts.
