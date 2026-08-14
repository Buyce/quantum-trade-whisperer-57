# Remove the TradingView bottom ticker bar

## What changes

- Delete the fixed bottom ticker bar (the third-party TradingView ticker tape script embed) from the Signal Feed.
- Keep the "Last background scan completed at…" heartbeat indicator in the Capital Preservation Mode empty state — that reads our own scanner timestamp and is unrelated to TradingView.

## Will this harm anything?

No. The ticker was purely decorative and fully isolated:

- It only mounted a third-party script in its own container; it never read or wrote our database, scanner pipeline, or MetaApi quote endpoint.
- The live price chips on signal cards come from our own `/api/public/quotes` endpoint, not TradingView, so entry-distance tracking is unaffected.
- No changes to the grading algorithm, cron schedule, queue worker, retention purge, alerts, or any table.

Side benefit: one fewer external script and iframe on the feed, plus the bottom of the page reclaims ~46px.

## Technical notes

- `src/components/MarketTicker.tsx`: remove the `MarketTicker` component and its script-injection effect; keep `ScanHeartbeat` (file renamed in place is unnecessary — the export stays).
- `src/routes/_authenticated/feed.tsx`: drop the `<MarketTicker />` render and adjust the import to `ScanHeartbeat` only; remove the bottom padding spacer added for the bar.
- No migrations, no server functions, no scanner changes.
