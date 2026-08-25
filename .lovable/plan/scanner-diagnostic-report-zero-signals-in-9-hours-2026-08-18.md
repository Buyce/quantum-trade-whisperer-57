# Scanner Diagnostic Report — Zero Signals in 9 Hours

Audit complete. **No infrastructure failure.** Database, triggers, queue, cron, MetaApi and the worker chain are all healthy. The silence has two causes: current market structure (legitimate No-Trade) plus one real directional bug in the barrier calculation that makes most short setups impossible to publish.

## Step-by-step findings

**1. Database / triggers / schema — healthy.**
`scanned_signals` holds 66 rows, latest `2026-08-18 01:30:15Z`. The `shadow_enroll_on_signal` trigger is firing correctly: `shadow_queue` shows 66 rows, all `done`, zero `failed`/`processing`. No NOT NULL failures — every recently added column (`max_acceptable_entry`, `p_fill_prior`, `p_win_prior`, `ev_prior`, `prior_sample_n`, `structure_key`, `tp1_r`…`max_r`) is nullable, and 66 rows were written through this exact schema. No write path is being rejected.

**2. Queue and worker state — healthy.**
`scan_queue` latest cycle `11:00:00Z` completed all three instruments within 21 seconds. Zero rows stuck in `processing`. Results since 09:45: **every job returns `no_trade` with "No structure satisfied the ABC grading rules"** — the pipeline runs to completion and consciously declines. Earlier failures (20 `failed`, 185 `skipped`) were MetaApi 504s and 8s timeouts on the H4 fetch around 09:30–09:45; those cleared, and `instrument_health` now shows all three instruments `available = true`, no `last_error`.

**3. MetaApi — healthy.**
Live dry-run fetch of all three instruments across H4/H1/M15: HTTP 200, full 300/300/200 bars, **2.6–3.0s per instrument for three timeframes**. No 401, no 429, no timeouts.

**4. Cron and workers — firing.**
Cycles landed at 10:15, 10:30, 10:45, 11:00 (plus a manual 10:58 run), all authorized and all completing. No 401s, no 500s. Hourly shadow-resolve path shows no stuck jobs.

**5. Pipeline dry-run — this is where signals die.**

| Instrument | H4 / H1 / M15 bias          | Grade | Rejected at                    |
| ---------- | --------------------------- | ----- | ------------------------------ |
| XAUUSD     | bullish / neutral / neutral | none  | M15 bias neutral → No Trade    |
| EURUSD     | bullish / neutral / neutral | none  | M15 bias neutral → No Trade    |
| GBPAUD     | neutral / bearish / bearish | B     | `barrierRoom <= 0` → discarded |

XAUUSD and EURUSD are a **correct** No-Trade: the M15 EMA stack (20/50/200) is not stacked, so there is no directional structure to trade. Nothing to fix there.

GBPAUD is a genuine defect. It produced a valid B-Grade short — entry 1.90431, stop 1.90597, risk within the ATR ceiling — and was then thrown away because the reachable-extension check computed **maxR = −8.85**.

## The bug

`readTimeframe` in `src/lib/scanner/grading.ts` picks the macro barrier from the **H4 timeframe's own bias**, not from the direction being traded:

```text
barrier = (h4.bias === "bearish") ? rangeLow : rangeHigh
```

`buildTradeProfile` then measures room as `(h4.barrierPrice − entry) × sign`. For a short trade, `sign = −1`, so room is only positive if the barrier sits _below_ entry. But whenever H4 is neutral or bullish, the barrier is the range **high** — above entry — so room is negative and `barrierRoom <= 0` rejects the setup before any target is built.

Consequence: **a short can only ever publish when H4 is itself bearish.** The database confirms it — 63 long signals vs 3 short. Today's markets are H4-bullish across the board, so the one qualifying structure was a short and it was silently discarded.

## Minimal fix

One change, in `src/lib/scanner/grading.ts`:

- Return **both** range extremes from `readTimeframe` (`rangeHigh`, `rangeLow`) alongside the existing `barrierPrice`, leaving `barrierPrice` and `barrierDistanceAtr` untouched so grading, the `nearMacroBarrier` rule and A/B/C tiers behave exactly as today.
- In `src/lib/scanner/profile.ts`, select the barrier by **trade direction**: `direction === "long" ? h4.rangeHigh : h4.rangeLow`. Long setups keep the identical value they use now — nothing about existing long behaviour changes.
- Update the `TimeframeRead` type in `src/lib/scanner/types.ts` with the two new fields.

Everything downstream (risk, target multiples, `maxR`, slippage tolerance, structure key, cooldown, dedupe index) is already direction-aware and needs no edit.

## Explicitly out of scope

No migrations, no changes to `scanned_signals`, `shadow_executions`, `regime_stats` or `regime_snapshots`. No backfill or rewrite of historical rows — the 66 existing signals and the shadow telemetry dataset stay byte-identical. No seeded or synthetic signals: after the fix, an empty feed still means No Trade.

## Verification after the patch

1. Re-run the same in-memory dry-run on live candles and confirm GBPAUD reaches `PUBLISHABLE` with a positive `maxR`, and that XAUUSD/EURUSD long paths produce unchanged `maxR` values.
2. Trigger one real scan cycle and confirm the GBPAUD short is written to `scanned_signals` with sane entry/stop/targets, and that `shadow_queue` enrolls it.
3. Confirm the short's stop is above entry and its targets below — a mirrored sanity check on target ordering.
