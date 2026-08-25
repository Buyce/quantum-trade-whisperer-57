# Feed retention cutoff + Trade History tab

## What the database actually shows

The hourly retention job is working. It has run successfully every hour, and every signal older than its grade window has been deleted — except signals you logged a trade decision on, which the job deliberately keeps so your history survives. Those protected rows are the 6-day-old cards still visible in the feed. The only other leftovers are B-grade signals from Aug 11 that are still inside their 36h window.

So retention is fine; the feed is just showing rows it should no longer show.

## What we will build

### 1. Feed hides signals past their retention window

The signal feed will only show signals inside their grade window, measured from detection:

- C-grade: up to 24h
- B-grade: up to 36h
- A / A+ grade: up to 48h

Anything older disappears from the feed even if it survived deletion because it was logged. Live (active) setups are unaffected, as are the "Active only" toggle, filters, daily cap counter, and the Capital Preservation Mode empty state.

### 2. New "Trade History" tab

A new page in the top navigation listing every signal you logged as **Taken**, newest first, with no time limit. Each row shows instrument, grade, direction, entry / stop / targets, R:R, the outcome, and when it was detected. Outcome editing (win / loss / breakeven / R-multiple) works the same as it does today on the Performance page.

Performance history and its metrics stay exactly as they are.

### 3. Skipped signals are not retained

Skipped decisions carry no value once the setup is gone, so:

- The retention job stops protecting a signal that only has skipped decisions — those signals get deleted on schedule like any other, along with their skipped log rows.
- Existing skipped log rows and the old signals they were holding alive get cleaned up in the same change.
- Only Taken signals are kept forever, so Trade History and Performance never lose real trades.

## Technical notes

- Add a shared retention-window helper (grade -> hours) in `src/lib/db-types.ts` mirroring the SQL thresholds in `purge_expired_signals()`, so UI and database use one source of truth.
- `src/routes/_authenticated/feed.tsx`: apply the retention cutoff in the existing filter memo, before the "Active only" filter.
- New route `src/routes/_authenticated/history.tsx` reading `executed_trades` filtered to `user_decision = 'taken'` joined to `scanned_signals`, using the existing browser client and query patterns; add a nav link in `src/components/AppShell.tsx`, plus its own `head()` metadata.
- Migration: update `purge_expired_signals()` so the "referenced by a trade" exclusion only counts `user_decision = 'taken'`, and delete `executed_trades` rows with `user_decision = 'skipped'` for signals past their retention window before deleting the signals.
- No scanner or grading changes, no seeding or mock rows.
