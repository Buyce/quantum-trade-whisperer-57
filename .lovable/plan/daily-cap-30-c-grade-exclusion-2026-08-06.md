# Daily cap 30 + C-Grade exclusion

Feasible with no schema restructuring — one small migration for the default, plus targeted logic edits.

## 1. Daily cap: 15 → 30

- Migration: change the `scanner_settings.daily_setup_cap` column default to 30, and update existing rows still sitting at 15 so current users get the new limit.
- Same migration adds `alert_min_grade` (signal_grade, default `B`) to `scanner_settings`, separate from the existing `min_grade` feed filter.
- Scanner constant `DEFAULT_DAILY_SETUP_CAP` in `src/lib/scanner/types.ts`: 15 → 30.
- Frontend fallbacks: Settings form initial state (`useState(15)`) and the feed's `cfg?.daily_setup_cap ?? 15` both become 30.

## 2. C-Grade bypasses the cap

- `countToday()` in `src/lib/scanner/pipeline.server.ts` currently counts every signal detected today. Add a filter so only `A+`, `A`, `B` rows count toward the quota.
- The cap gate runs before grading, so it moves to after the trade profile is built: if the graded setup is C, publish it regardless of the count; if it is B or better, apply the 30 cap. Cap message and `capped` job result stay as-is.
- Feed "Setups today" counter mirrors this: counts only A+/A/B against the cap, so the number on screen matches the scanner's quota. C-Grade signals still render in the feed list.

## 3. User-configurable alert threshold (no server-side C mute)

- Settings page gains an "Alert minimum grade" control in the Alerts block: `A+ only`, `A and above`, `B and above`, `C and above`, saved to `alert_min_grade` and independent of the feed's minimum-grade filter.
- `scannerSettingsQuery` in `src/lib/queries.ts` and the `ScannerSettingsRow` type in `src/lib/db-types.ts` select/expose the new column.
- `src/lib/scanner/alerts.server.ts`: fan-out reads `alert_min_grade` (falling back to `B` when unset) and compares the signal's grade rank against it — no hardcoded C exclusion. A user on "C and above" receives C-grade emails.
- Browser/Android push in `src/routes/_authenticated/feed.tsx`: the realtime insert handler checks the inserted signal's grade against the same saved threshold before firing a `Notification`.

## 4. Global KPIs exclude C-Grade

- In `src/routes/_authenticated/performance.tsx`, derive a `coreSamples` set (samples with grade ≠ C) and feed it to the top-row KPIs (Expectancy / trade, Win rate, Avg win/loss, Total R and the rest of that grid), the natural-language insights, R-distribution and heat map.
- The "By Grade Tier" table keeps using the full sample set, so the C row still renders with its own numbers. Same for the by-instrument table.
- Add a short caption under the KPI grid noting the global math is B-Grade and above, so the tier table's C row not summing into the header is explained rather than looking like a bug.

## Technical notes

- No changes to grading, MetaApi fetching, or queue mechanics; C setups are still detected, stored, and shown.
- Cap enforcement stays central (scanner-side, `DEFAULT_DAILY_SETUP_CAP`); per-user `daily_setup_cap` remains a display/filter value as today.
- Files touched: migration, `src/lib/scanner/types.ts`, `src/lib/scanner/pipeline.server.ts`, `src/lib/scanner/alerts.server.ts`, `src/lib/queries.ts`, `src/lib/db-types.ts`, `src/routes/_authenticated/feed.tsx`, `src/routes/_authenticated/performance.tsx`, `src/routes/_authenticated/settings.tsx`.
- Zero-Hallucination rule respected: no seeds, no placeholder rows; empty states unchanged.

&nbsp;

The revised plan is 100% APPROVED! Please execute the implementation across all touched files:

1. Migration & DB Types:

   - Run the migration to update `scanner_settings.daily_setup_cap` default to 30 (updating existing rows) and add `alert_min_grade` (type signal_grade, default 'B').

   - Update `src/lib/db-types.ts` and `src/lib/queries.ts` to include `alert_min_grade`.

   - Update `DEFAULT_DAILY_SETUP_CAP` to 30 in `src/lib/scanner/types.ts`.

2. Pipeline & Cap Bypass:

   - Update `countToday()` in `pipeline.server.ts` to count only A+, A, and B signals toward the quota.

   - Move the daily cap evaluation post-grading so C-Grade setups bypass the quota count and publish to the feed.

   - Mirror this in the UI "Setups Today" counter (tracking A+/A/B against 30).

3. User-Configurable Alert Thresholds:

   - Add the "Alert minimum grade" dropdown in `settings.tsx` (Options: A+ only, A and above, B and above, C and above) bound to `alert_min_grade`.

   - In `alerts.server.ts` (email alerts) and `feed.tsx` (PWA push notifications), evaluate signal grades against `user.alert_min_grade`.

4. Performance Dashboard:

   - In `performance.tsx`, calculate top-row KPIs using `coreSamples` (grade !== 'C') to reflect core system expectancy.

   - Keep the "By Grade Tier" and "By Instrument" tables rendering full samples.

   - Add the explanatory caption under the main KPI grid noting global math reflects B-Grade and above.
