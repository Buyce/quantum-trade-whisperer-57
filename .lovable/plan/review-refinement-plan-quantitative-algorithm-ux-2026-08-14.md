# Review & Refinement Plan — Quantitative Algorithm & UX

I audited the live rows and the pipeline math. Three of your four hypotheses treat symptoms; the underlying causes are different, and one of them (R:R) is a genuine unit bug. Findings first, then the proposed work.

## What the live data actually shows

Last 10 EURUSD B-grade longs (08:00 → 10:30 today):

```text
time   entry     stop      risk(ATR)  rr_ratio
08:00  1.15515   1.15378     4.57      0.50
08:30  1.15531   1.15377     4.97      0.50
09:15  1.15550   1.15419     3.97      0.50
09:45  1.15524   1.15436     2.67      0.68
10:15  1.15547   1.15493     1.64      1.02
10:30  1.15535   1.15493     1.31      1.34
```

Three verified facts:

1. **The dedupe index is structurally unable to fire.** `scanned_signals_active_unique` keys on rounded `entry_price`, and entry is `last M15 close` — it drifts every candle. The _stop_ (the structural anchor) is literally identical across six of those rows. So the engine is republishing one structure while the uniqueness key looks new every time. A pip-variance band on entry is the same flawed axis, just wider.
2. **Stops are not uniformly tight — risk is unstable.** Risk ranged 1.3–5.5 M15 ATR on the same structure. Cause: risk = distance from _drifting entry_ to a fixed 10-bar extreme, plus a `0.35 × M15 ATR` buffer. On EURUSD that buffer is ~0.4 pip — below spread + noise, so the extreme itself becomes the stop. Multiplying the buffer alone (your hypothesis) fixes the noise cushion but not the unstable risk.
3. **`rr_ratio` is not the R:R of the printed targets.** TP1/TP2/TP3 are hardcoded at exactly 1R/2R/3R off entry, while `rr_ratio = clamp(reachableAtr × (m15Atr / risk), 0.5, 3)` — `reachableAtr` is measured in **H4** ATR units and multiplied by an **M15** ATR, a unit mismatch. The number is not derived from any target price. That is why a 1.02R headline sits above a "TP3 · 1:3" box.

## Proposed solutions

### 1. Structural dedupe (replaces the pip-variance cooldown)

Deduplicate on the **structure**, not the price:

- Add a `structure_key` on `scanned_signals`: `instrument | direction | swing-A time | swing-B time | rounded stop anchor`. Two scans of the same ABC leg produce an identical key; a genuine new leg (new swing B, new anchor) produces a new one.
- Move the partial unique index to `(structure_key) WHERE status = 'active'`; keep it as the single source of truth (insert 23505 → `duplicate`), so the race window stays closed.
- Add a **structure cooldown**: suppress a republish of the same `structure_key` within N minutes even after the prior one expired/resolved (default 120m, configurable constant). This is what preserves legitimate re-entries: a second tap of the same zone after a new swing B still publishes.
- Backfill `structure_key` as NULL for legacy rows (the index is partial, so they are unaffected).

Rejected: pip-variance bands — they can't distinguish "same structure, price drifted 8 pips" from "genuine new break 8 pips higher", and the correct band differs per instrument (XAUUSD vs EURUSD).

### 2. Stop-loss and risk normalisation

Industry practice for a 15m breakout is **1.0–1.5 × ATR beyond the structural extreme**, plus an explicit spread allowance; and the reference ATR should be the timeframe you're managing risk on with a higher-timeframe floor so the stop survives H1 noise.

Proposed math (per instrument, in `profile.ts`):

```text
buffer      = max(1.2 × M15_ATR, 0.5 × H1_ATR, spreadFloor(instrument))
stop        = structuralExtreme ∓ buffer
risk        = |entry − stop|
riskCapATR  = clamp(risk, 1.0 × M15_ATR, 3.0 × M15_ATR)   // reject if risk > cap
```

- Setups whose risk exceeds 3 × M15 ATR are **rejected as No-Trade** rather than published with a 0.50 R:R — that alone removes most of the 08:00–09:15 spam batch.
- `spreadFloor` is a per-instrument constant (EURUSD ≈ 1.5 pip, GBPAUD ≈ 3 pip, XAUUSD ≈ 0.30) so the buffer can never fall below realistic execution cost.
- Entry becomes the **structural break level** rather than "wherever the last candle closed", which is what makes risk stable across consecutive scans and makes the limit-order framing honest.

### 3. Honest targets and a real R:R

Fix the number first, then the UI:

- Compute a real reachable price: `barrierPrice` (nearest H4 structural barrier), then `maxR = (|barrier − entry|) / risk`, clamped to a floor of 1.0 (below that, No-Trade).
- Derive targets from `maxR` instead of hardcoding 1/2/3:
  - `maxR ≥ 3` → TP1 1R, TP2 2R, TP3 3R (unchanged).
  - `1.5 ≤ maxR < 3` → scale to `0.5 × maxR`, `0.75 × maxR`, `maxR`.
  - `maxR < 1.5` → **two** targets only (`0.6 × maxR`, `maxR`); TP3 is stored NULL.
- `rr_ratio` becomes exactly `TP-final R` — the headline and the boxes can no longer disagree. Confidence's `rr` component reads the same value.
- `SignalCard.tsx`: render targets from the stored values with their true multiples ("TP2 · 1:0.8"), omit the box entirely when the target is NULL, and show a "capped by H4 barrier" chip with the barrier reason in the breakdown. No fake 1:2/1:3 labels.

Rejected: keeping three boxes and rescaling silently — the trader needs to _see_ that the structure is capped, not just smaller numbers.

### 4. Entry latency and live distance

Architecture check: a per-client MetaApi quote poll would multiply requests by user count against the same broker token — not acceptable. The safe pattern is **one shared cached quote source**:

- Add `GET /api/public/quotes` returning last price for the three instruments, with a short server-side cache (15s TTL) and `Cache-Control: public, max-age=15` so the edge, not MetaApi, absorbs the fan-out. One upstream call per 15s regardless of how many users are watching.
- Feed cards show **live distance from entry** in pips and in R units (`+0.4R away — price has run past entry`), plus one of three states: _Awaiting fill_ (price the correct side of entry), _At entry_, _Invalidated_ (price beyond entry by > 0.5R, or already past stop).
- Reinforce the limit-order framing: the existing `BUY LIMIT / SELL LIMIT` badge becomes always-on (not Guide-Mode only), and the copy block already emits the pending-order layout.
- Latency itself is not removed — but the invalidation state means a stale signal visibly retires itself instead of quietly misleading.

## Technical notes

- Backend touch points: `src/lib/scanner/profile.ts` (stops, targets, maxR, entry level), `src/lib/scanner/indicators.ts` (barrier price accessor, swing timestamps for the structure key), `src/lib/scanner/pipeline.server.ts` (structure key + cooldown, NULL-able tp3), one migration (`structure_key` column, replacement partial unique index, `tp3` nullable).
- Frontend: `SignalCard.tsx` (dynamic target grid, cap chip, live distance), `feed.tsx` (quote polling hook), new `src/routes/api/public/quotes.ts`.
- Zero-hallucination rule respected: no seeds, no fixtures; if the quote endpoint fails, distance renders "—", never an estimate.
- Cron schedule, worker budget, retention and grading tiers are untouched. Historical rows keep their stored values; no recompute.

## Sequencing

1. Migration + structure-key dedupe and cooldown (stops the spam immediately).
2. Stop/risk normalisation and No-Trade rejection of over-wide risk.
3. Real `maxR`, dynamic targets, `SignalCard` target grid.
4. Cached quote endpoint and live-distance tracker.
