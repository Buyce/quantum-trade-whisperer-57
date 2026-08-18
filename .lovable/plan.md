# Phase 0 — Fill Diagnostic (never_filled cohort)

Read-only analysis executed. 52 `never_filled` rows (72% of 72 shadow rows) were replayed against freshly fetched real M15 candles from the broker feed for the 30-minute TIF window after `detected_at`. Zero rows written, no schema touched.

## Headline finding

The TIF window is not the primary defect. **Two fill-detection bugs in `replay.ts` are mislabelling real fills as `never_filled`, and the entry offset is far too greedy on the rest.**

| Cohort (n=52) | Count | Share |
|---|---|---|
| Price actually traded through the limit inside 30m (should be filled) | 9 | 17% |
| "Just missed" (< 0.2 x ATR) | 0 | 0% |
| Missed by 0.2–1.0 x ATR | 16 | 31% |
| "Runaway" (> 1.0 x ATR, never retraced) | 27 | 52% |

Closest-approach distribution for the 43 genuine misses: median **1.47 x ATR**, mean 1.62, p25 0.68, p75 2.26, max 5.25. Median miss in pips: EURUSD 5.5, GBPAUD 7.7, XAUUSD 57.8.

There is no "greedy by a hair" cohort at all — the gap between entry and the best price reached is structural, not marginal.

## Distribution

By instrument (n / traded-through / median true miss in ATR):

- XAUUSD: 25 / 2 / 0.83
- EURUSD: 21 / 4 / 1.77
- GBPAUD: 6 / 3 / 1.15

By session:

- tokyo: 19 / 2 traded through / median miss 0.74 ATR
- london: 15 / 7 / 0.99
- sydney: 9 / 0 / 2.00
- london_new_york_overlap: 7 / 0 / 3.01
- unlabelled: 2 / 0 / 1.59

Failures are **not** Asian-session specific. Tokyo has the *smallest* miss distance; the worst misses are in the London/NY overlap and Sydney, i.e. the momentum-driven and thin-liquidity extremes. 46 of 52 unfilled rows are longs — entries are being placed below a market that keeps ticking up.

## TIF sensitivity (counterfactual fills)

| TIF | Would have filled |
|---|---|
| 30m (current) | 9 / 52 (17%) |
| 45m | 9 / 52 (17%) |
| 60m | 13 / 52 (25%) |
| 90m | 21 / 52 (40%) |
| 120m | 22 / 52 (42%) |
| 240m | 25 / 52 (48%) |

45 minutes buys literally nothing. Even a 4-hour TIF leaves half the cohort unfilled, and a long-lived limit order degrades label quality (the market it was graded in no longer exists).

## Confirmed replay defects

1. `relevant = candles.filter(c => ms(c.time) > cursor)` with `cursor = detected_at` discards the M15 bar that is in progress at detection. That bar is where a limit set near current price most often fills, so the effective TIF is one bar, not two.
2. `touched = candle.low <= entry && candle.high >= entry` returns false when a bar trades entirely through the entry (long: whole bar below entry). The intended gap-fill branch below it is therefore unreachable, and such bars are counted as no-fill.

These two account for the 9 traded-through rows and bias the label set toward label 0.

## Recommendation

Do **not** raise TIF to 45 minutes — the data shows a 0% marginal gain.

1. Fix the two fill-detection defects (bar-inclusion window and gap-through fill) and re-replay the 52 rows. Expected: ~17% of the cohort re-labels to genuine win/loss outcomes, removing a systematic label-0 bias before any model training.
2. Then address the entry offset, which is the real cause: the retracement entry sits a median 1.47 x ATR away from where price actually goes. Options to evaluate on the corrected dataset — cap the entry offset at a fraction of ATR from detection price, or split each signal into a limit leg plus a market/stop-entry leg for the >1.0 ATR runaway regime (52% of the cohort).
3. Keep TIF at 30 minutes for now; re-measure fill rate after (1) and (2). If a TIF change is warranted later, 60m is the first point with real signal (17% -> 25%), not 45m.
4. Log the closest-approach metric (`miss_atr` at TIF expiry) on unfilled shadow rows so this diagnostic becomes continuous rather than ad hoc.

No schema or database changes were made by this diagnostic. Items 1–4 are proposals awaiting your approval.
