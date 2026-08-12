# Client-Side Data Export for LLM Analysis

Feasibility confirmed: both pages already hold everything needed in React Query state. No server routes, no schema changes, no scanner changes.

## What you get

1. **Signal Feed → Export Signals (JSON)**
   - Ghost button beside Refresh in the feed header.
   - Exports exactly the setups currently visible (retention window + "My settings filter" + "Active only" applied), so the file matches what you see.
   - Clean, LLM-friendly objects: timestamp, instrument, grade, action (LONG/SHORT), entry, stop_loss, targets {tp1, tp2, tp3}, r_multiple, confidence_score, pillars {trend, order_block, momentum, volatility_expansion}, timeframe biases, session/volatility context, status, resolved outcome, and the qualitative breakdown text.
   - Downloads as `ptrades_signals_export_YYYY-MM-DD.json`. Disabled when the feed is empty.

2. **Performance → Export Metrics (CSV)**
   - Ghost button beside the scope toggle.
   - Exports the currently active sample set (My trade log or Scanner baseline).
   - Headers: `Date, Instrument, Grade, Outcome, R_Yield`.
   - Downloads as `ptrades_performance_mine_YYYY-MM-DD.csv` or `..._baseline_...csv`. Disabled when there are no samples.

3. **Trade History → Export Trade History (CSV + JSON)**
   - Two ghost buttons in the History page header: `Export History (CSV)` and `Export History (JSON)`.
   - Covers every trade you logged as *taken*, permanent record, ideal for trend hunting.
   - CSV columns (flat, spreadsheet/LLM-ready): `Logged_At, Detected_At, Instrument, Grade, Direction, Session, Entry, Stop_Loss, TP1, TP2, TP3, Planned_RR, Confidence, Pillar_Trend, Pillar_Order_Block, Pillar_Momentum, Pillar_Volatility, Outcome, R_Yield, Notes`.
   - JSON version keeps the same fields plus the qualitative breakdown text, nested per trade, for richer LLM reasoning.
   - Filenames: `ptrades_trade_history_YYYY-MM-DD.csv` / `.json`. Disabled when the log is empty.

Zero-data case is respected: no placeholder rows are ever written; an empty sample set simply disables the button.

## Technical notes

- New `src/lib/export.ts`: `downloadBlob(filename, blob)`, `signalsToExportJson(signals)`, `samplesToCsv(samples)` with CSV escaping. Synchronous, browser-only, `URL.createObjectURL` + revoke.
- `src/lib/performance.ts`: add a `detectedAt` (ISO string) field to `RSample` in both `samplesFromSignals` and `samplesFromTrades` so CSV can carry a Date column. Purely additive; existing math untouched.
- `feed.tsx` exports from the existing `visible` memo; `performance.tsx` exports from the existing `samples` array.
- No changes to `pipeline.server.ts`, cron, migrations, or any `/api` route.
