# Tiered hard-deletion retention for scanned signals

## What we will build

Add a time-based cleanup so the database does not accumulate old signals forever. Higher-grade setups are kept longer because they are more valuable for post-trade review; lower-grade setups are removed sooner to keep the table lean.

## Retention rules

- **C-grade** signals: permanently deleted **24 hours** after they are detected.
- **B-grade** signals: permanently deleted **36 hours** after they are detected.
- **A and A+ grade** signals: permanently deleted **48 hours** after they are detected.

The existing 24-hour expiry sweep still runs first (marks `status = 'expired'`), then this cleanup removes the rows after the extra grade-specific grace period.

## Why this design

- Matches the request: "delete expired C grade setups every 24hrs, B grade setups every 36hrs and A and above grade setups every 48hrs".
- Preserves user trade history: a signal referenced by any row in `executed_trades` is **not deleted**, even after its retention window passes.
- Keeps `market_context` in sync: child rows are removed before their parent signal is deleted.
- Uses SQL-only `pg_cron` because the task is pure data cleanup; no external HTTP endpoint is needed.

## Technical changes

### 1. Database migration

- Add an `expired_at` timestamp column to `scanned_signals` so the cleanup can measure the grade-specific grace period from the exact moment a signal was marked expired.
- Create a `purge_expired_signals()` function that:
  1. Identifies signals where `status = 'expired'` and `expired_at` is older than the grade-specific threshold.
  2. Excludes any signal still referenced by `executed_trades`.
  3. Deletes matching `market_context` rows first.
  4. Deletes the matching `scanned_signals` rows.
- Schedule the function to run every hour with `pg_cron`.

### 2. Scanner pipeline update

- Update `expireStaleSignals()` in `src/lib/scanner/pipeline.server.ts` to set `expired_at = now()` whenever it flips a row from `active` to `expired`.

### 3. UI / query impact

- No changes to the feed query or empty state logic. The cleanup simply removes old rows that are already hidden by the "Active only" toggle; live signals and the Capital Preservation Mode behavior remain unchanged.
- No seed data, mock signals, or synthetic rows are introduced.

## Files and tables touched

- Migration: `scanned_signals` table (add `expired_at`), new `purge_expired_signals()` function, new `pg_cron` job.
- Code: `src/lib/scanner/pipeline.server.ts` only.
- Untouched: grading, MetaApi fetching, queue mechanics, alert rules, daily cap, performance KPIs, and the feed UI.
