# Session-Aware Dynamic Entry Offset — Phase 1 Audit + Phase 2 Implementation

## Phase 1: Triple-check pre-audit

### Checkpoint 1 — R-multiple cascade: CLEAR (with one ordering requirement)

Verified in `src/lib/scanner/profile.ts`: every downstream number is derived from `entryPrice` at
computation time, not hardcoded.

```text
entryPrice ──> risk = |entryPrice - stopLoss|
           ──> barrierRoom = (h4Barrier - entryPrice) * sign
                 └─> maxR = barrierRoom / risk
                       └─> tp1R/tp2R/tp3R (scaled to maxR) ──> tp1/tp2/tp3 = entry + sign*risk*R
                             └─> rrRatio = tp3R ?? tp2R
           ──> maxAcceptableEntry = entry + sign*risk*tolerance
```

So a wider stop automatically produces wider TP distances (they are `risk * R`, absolute prices are
recomputed) and R:R stays truthful because `rrRatio` is literally the final target's R. `stopLoss`
is independent of entry (structural extreme + ATR buffer), so it does not move.

Requirement: the offset must be applied **before** the `risk`/`maxR`/target block, i.e. immediately
after `entryPrice` is first assigned. No target math may be duplicated.

### Checkpoint 2 — Risk invalidation guardrail: NOT SAFE AS-IS, needs fallback

Two existing rejections key off `risk`, and moving the entry toward the market widens it:

- `MAX_RISK_ATR = 3`: `if (m15.atr > 0 && risk > m15.atr * 3) return null` — hard No-Trade.
- `MIN_REACHABLE_R = 1`: larger `risk` shrinks `maxR = barrierRoom / risk`, so a setup can drop
  under 1R and be discarded.

Left untouched, the overlap regime would trade a 13% fill rate for silently dropped signals. Safe
handling (proposed, no threshold weakening): treat the dynamic entry as an **attempt**. Compute the
shifted entry, re-derive `risk` and `maxR`; if either guard fails, **fall back to the structural
Point C entry** and continue through the unchanged guards. A setup is therefore never lost by the
new feature — worst case it publishes exactly as it does today. `MAX_RISK_ATR` and
`MIN_REACHABLE_R` are not changed.

### Checkpoint 3 — Type and payload safety: CLEAR (session must be threaded in)

- `trading_session` is **not** currently available to `profile.ts`. It is computed in
  `src/lib/scanner/pipeline.server.ts` as `sessionOf(now)` _after_ `buildTradeProfile(...)` runs,
  and written to `market_context.trading_session`. Fix: hoist `const session = sessionOf(now)`
  above the profile build and pass it into `buildTradeProfile({ instrument, candles, session })`.
  `market_context` keeps using the same variable, so the row and the entry math can never disagree.
- `scanned_signals` schema: unchanged. `entry_price` is `numeric`; no new columns, no migration.
- `structureKeyOf` keys on instrument/direction/A-time/B-time/**stopLoss** — not entry — so the
  120-minute cooldown and the active-setup unique index behave identically after the shift.
- Webhook: `src/lib/scanner/webhook.server.ts` emits `price=${fmt(signal.entryPrice)}` for
  PineConnector and `entry: signal.entryPrice` for JSON. Both take whatever number the profile
  produces; comma-separated syntax and field order are untouched. The webhook payload tester is
  unaffected.
- Shadow engine / `replay.ts`: consumes `entry_price` from the row. A closer entry improves the fill
  leg; no code change needed. Existing rows keep their original entries, so the dataset stays honest
  (post-change rows are simply a new regime).

Audit verdict: cleared, conditional on the fallback in Checkpoint 2 and the session threading in
Checkpoint 3.

## Phase 2: Implementation

Files touched: `src/lib/scanner/profile.ts`, `src/lib/scanner/types.ts`,
`src/lib/scanner/pipeline.server.ts`. No database or UI changes.

1. `types.ts` — add constants:
   - `RUNAWAY_SESSIONS = ["london_new_york_overlap"]`
   - `DYNAMIC_ENTRY_ATR_FRACTION = 0.3`
   - `MIN_DYNAMIC_RISK_ATR = 0.5` (stop-crossover floor)
2. `profile.ts` — `BuildProfileInput` gains optional `session?: string`. After `entryPrice = abc.c`
   and after `stopLoss` is computed, apply the offset when `session` is a runaway session:

   ```text
   long : candidate = lastClose - 0.3 * atr
   short: candidate = lastClose + 0.3 * atr
   ```

   Guardrails, applied in order:
   - **No worse than market**: long `candidate <= lastClose - spreadFloor`; short
     `candidate >= lastClose + spreadFloor`. (Satisfied by construction for 0.3 ATR > spread, but
     enforced explicitly so a future fraction change cannot invert it.)
   - **Never further from market than structural C**: long `candidate = max(candidate, abc.c)`,
     short `candidate = min(candidate, abc.c)`. The offset can only ever move the entry _toward_
     price, never deeper.
   - **Never crosses the stop**: require `|candidate - stopLoss| >= MIN_DYNAMIC_RISK_ATR * m15.atr`
     and the correct side of the stop; otherwise reject the candidate.
   - **Risk / reachability**: recompute `risk` and `maxR` with the candidate; keep it only if
     `risk <= MAX_RISK_ATR * atr` and `maxR >= MIN_REACHABLE_R`.
   - Any failed guard ⇒ keep `abc.c`. Existing behaviour, byte for byte.

3. All existing target, `maxR`, `rrRatio`, `maxAcceptableEntry` and slippage-tolerance math runs once
   on the final entry — no duplication.
4. `qualitativeBreakdown` gains one sentence when the offset fires, so the card explains why the
   entry is not at Point C.
5. `pipeline.server.ts` — move `sessionOf(now)` above the profile build and pass `session` in.

### Verification after implementation

- Typecheck.
- Dry-run `buildTradeProfile` on freshly fetched live candles for XAUUSD / GBPAUD / EURUSD with
  `session` forced to `london_new_york_overlap` vs `tokyo`, and print entry, stop, risk in ATR,
  maxR, tp1..tp3 and R:R for both — proving the fallback path and that no setup is lost.
- Confirm the webhook tester still renders a valid PineConnector line.

No seeding, no mock rows, no schema change.
