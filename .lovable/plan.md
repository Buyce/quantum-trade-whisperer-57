# Database Purge & Zero-Mock Data Enforcement

Audit result: the only demo-data source in this project is a generator block inside the original Build 1 migration, which inserted 180 synthetic signals plus matching market context. The live app code (data fetch layer, feed, performance dashboard, signal card) contains **no** hardcoded arrays, mock fixtures, or fallback signal generators — every read already goes straight to the database.

Current row counts confirmed: 180 scanned signals, 180 market context rows, 6 executed trades.

## 1. Database purge (migration)

One migration that clears demo rows in dependency order:
- delete all executed trades
- delete all market context rows
- delete all scanned signals

Market context and executed trades both reference signals, so they are removed first to leave zero orphaned rows. Instrument health rows for XAUUSD / GBPAUD / EURUSD are real operational state and stay. Scanner settings and profiles are real user data and stay.

## 2. Remove seeding capability

- Neutralize the synthetic-signal generator in the historical Build 1 migration file so the block can never run again on a fresh environment (it becomes a no-op with a comment explaining the removal). The already-applied schema statements in that file stay byte-identical.
- Sweep confirmed no other seed scripts, mock JSON, or dummy generators exist in the app, API routes, or components. Nothing else to delete.

## 3. Zero-hallucination guardrail

- Add a short architectural rule to `AGENTS.md` stating that signal data may only originate from the live scanner pipeline, and that an empty result set must render the "Capital Preservation Mode Active" empty state — never placeholder setups.
- Add a defensive comment plus explicit empty-array contract in the signals fetcher so any future fallback insertion is obviously prohibited.
- Verify the feed's empty branch: with zero rows it already renders the Capital Preservation Mode state, and the performance dashboard renders zeroed tiers rather than invented stats. No behavioural change needed, only confirmation after the purge.

## Verification

After the migration runs: re-count all three tables (expect 0 signals, 0 context, 0 trades), then load the feed and performance pages to confirm the empty state and zeroed dashboards render cleanly with no console errors.

## Technical notes

- Purge is a data-only migration; no schema, RLS, or grant changes.
- Nothing in the scanner engine (`metaapi.server.ts`, `pipeline.server.ts`, `grading.ts`, `profile.ts`, `indicators.ts`) is touched — the live pipeline stays exactly as verified.
- The next 15-minute cron cycle will repopulate signals only when the grading rules actually qualify a setup.
