# Live Heartbeat: Market Ticker + Last Scanned Indicator

Frontend-only. The scanner engine, cron schedule, MetaApi pipeline and database schema are untouched.

## Audit findings

- `instrument_health` already exposes `instrument, available, last_error, unavailable_until` through an existing client query, and the table has an `updated_at` column that the scanner pipeline writes on every instrument fetch (both success and failure paths). Reading it needs zero backend changes — only adding `updated_at` to the existing SELECT column list.
- Current rows: all three instruments available, `updated_at` = 2026-08-06 04:01 UTC, so the value renders as a real timestamp today.
- DOM cost: the TradingView ticker tape mounts a single `<script>` inside one container div and renders its own sandboxed iframe. Three symbols, one iframe, no per-row React nodes — no measurable DOM bloat and no interaction with our data layer. It loads from TradingView's CDN on the client only. No new npm dependency is needed; the native embed script avoids pulling in `react-ts-tradingview-widgets`.

## 1. Live market ticker

New component `src/components/MarketTicker.tsx`:

- Client-only (mount effect injects the embed script once; guarded against double-mount and cleaned up on unmount).
- Symbols: `OANDA:XAUUSD`, `OANDA:GBPAUD`, `OANDA:EURUSD` with short display titles (Gold, GBP/AUD, EUR/USD).
- Dark theme, `displayMode: "compact"`, transparent background so it inherits the terminal surface.
- Rendered as a slim fixed bar pinned to the bottom of the viewport inside the signal feed page only, with a top border matching the header treatment and a small bottom padding spacer on the feed so the last card is never covered.

## 2. "Last scanned" heartbeat

- Extend the existing instrument-health query to also select `updated_at`.
- New small component (in `src/components/MarketTicker.tsx`'s sibling file or inline in the feed) showing a pulsing green dot plus text:
  `Last background scan completed at: 14:31 — Next scan in ~7 mins.`
- Time formatted in the user's local timezone; the "next scan" figure is derived client-side from the 15-minute cadence (minutes remaining until the next quarter-hour after the last scan), recomputed on a lightweight 30s interval.
- If the timestamp is missing or older than ~45 minutes, the dot switches to amber and the copy reads that the last scan was delayed, instead of claiming a fresh heartbeat.
- Placed inside the "Capital Preservation Mode / No Trade" empty state block on the feed, below the explanatory copy.

## Technical notes

Files touched:

- `src/lib/queries.ts` — add `updated_at` to the instrument-health select and its return type.
- `src/components/MarketTicker.tsx` — new: ticker bar + heartbeat indicator.
- `src/routes/_authenticated/feed.tsx` — render the heartbeat in the empty state, render the ticker bar, add bottom spacing.
- `src/styles.css` — add a subtle pulse keyframe utility if none exists.

No migrations, no server functions, no changes to `src/lib/scanner/*` or the cron/worker routes. The zero-hallucination rule is preserved: the empty state stays the empty state, only annotated with real scanner metadata.
