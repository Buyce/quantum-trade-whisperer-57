# P-Trades Hub — Build 1: Data Layer + Terminal Shell

Multi-user quantitative Forex terminal. This first build lands the full database
foundation, auth, and the complete dark data-dense UI running on realistic seeded
signals. The live MetaApi scanner and notifications follow in build 2.

## What you get in this build

- **Auth**: email/password + Google sign-in. Public landing page at `/`, everything
else behind login. Each user logs their own trade decisions against a shared
signal feed.
- **Signal Feed** (`/feed`): dense card/table list of Phase 2 Trade Profiles —
instrument, A/B/C grade badge, direction, entry, stop-loss, TP1/TP2/TP3,
R:R, confidence score bar, and the Qualitative Breakdown text block.
"Log as Taken" / "Log as Skipped" buttons write to `executed_trades`.
A "No Trade" empty state is the default, not an error.
- **Performance Dashboard** (`/performance`): Expectancy in R, win rate, average
win/loss in R, R-multiple distribution, per-instrument and per-grade breakdown,
a time-of-day × weekday heat map, and auto-generated natural-language insights
("Your Gold breakout trades have a 58% win rate with a 2.9R average.").
- **Settings** (`/settings`): scanner configuration (which of XAUUSD / GBPAUD /
EURUSD are active, which timeframes, which sessions the scanner runs in, daily
setup cap defaulting to 15, minimum grade to publish), notification toggles, and
the email-domain section with the exact `lovable_verify=` TXT and NS records to
paste into your registrar for `getptrades.com` / `notify.getptrades.com`.
- **Seeded demo data**: ~120 realistic signals and logged trades across several
weeks so the dashboard, heat map, and expectancy math are visibly working before
live data arrives.
- **Installable PWA**: manifest + icons so it adds to an Android home screen.

## Database

- `profiles` — display name, avatar, auto-created on signup.
- `scanned_signals` — timestamp, instrument, timeframe set, grade, direction,
entry, stop_loss, tp1/tp2/tp3, rr_ratio, confidence_score, the four confidence
components, qualitative_breakdown, atr, pattern_symmetry, status.
- `executed_trades` — user_id, signal_id, user_decision (taken/skipped), outcome
(win/loss/breakeven/open), realized_r_multiple, notes.
- `market_context` — signal_id, trading_session, volatility_index, time_of_day,
day_of_week.
- `scanner_settings` — per-user config from the Settings page.
- `instrument_health` — per-instrument availability flag used later when a MetaApi
fetch times out.

Signals and market context are readable by any signed-in user. `executed_trades`
and `scanner_settings` are strictly owner-scoped. A database function computes
expectancy and the grouped stats server-side so the dashboard stays fast.

## Technical notes

This project runs on TanStack Start, which has its own server runtime — so the
scanner logic goes in server functions and server routes rather than Supabase Edge
Functions. That removes the 2-second CPU / 256MB constraint entirely, but the
decoupled design you asked for is kept: `pg_cron` will hit a lightweight public
route every 15 minutes that enqueues one job row per (symbol, timeframe) into a
`scan_queue` table, and a second worker route drains one job at a time. Fetches get
the 8-second timeout wrapper, and a timeout marks the instrument temporarily
unavailable and moves on.

MetaApi will be called over the REST/RPC endpoints only — no streaming connection —
using the account details you gave (london, cloud-g2, high reliability, account
`f6a72106-…`). The account details go in code as configuration; the MetaApi auth
token goes in the secure secret store, not in the repo, and is read server-side
only. I'll request it at the start of build 2.

Grading, confidence weighting (40/30/20/10), Fibonacci targets, ATR-buffered stops,
and the qualitative breakdown generator are written as pure TypeScript modules in
this build and unit-covered against the seeded fixtures, so build 2 only swaps the
candle source from fixtures to live MetaApi.

## Build 2 (after you approve this)

Live MetaApi candles, `pg_cron` scheduling, the queue worker, realtime push
notifications on `scanned_signals` inserts, and the `notify.getptrades.com`
transactional email wiring.

&nbsp;

The plan is approved! Please make sure to include these three technical details in Build 1: 1. Secure all cron and queue worker routes with a CRON_SECRET authorization header so public requests cannot trigger them. 2. Ensure user-level `scanner_settings` (e.g., minimum grade filter, active sessions) act as user-specific UI/feed filters on top of the central scanner feed. 3. Automatically trigger the queue worker execution chain whenever new jobs are inserted into `scan_queue`.