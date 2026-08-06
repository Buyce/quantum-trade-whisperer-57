# Daily cap 30 + C-Grade exclusion

Feasible with no schema restructuring — one small migration for the default, plus targeted logic edits.

## 1. Daily cap: 15 → 30

- Migration: change the `scanner_settings.daily_setup_cap` column default to 30, and update existing rows still sitting at 15 so current users get the new limit.
- Scanner constant `DEFAULT_DAILY_SETUP_CAP` in `src/lib/scanner/types.ts`: 15 → 30.
- Frontend fallbacks: Settings form initial state (`useState(15)`) and the feed's `cfg?.daily_setup_cap ?? 15` both become 30.

## 2. C-Grade bypasses the cap

- `countToday()` in `src/lib/scanner/pipeline.server.ts` currently counts every signal detected today. Add a filter so only `A+`, `A`, `B` rows count toward the quota.
- The cap gate runs before grading, so it moves to after the trade profile is built: if the graded setup is C, publish it regardless of the count; if it is B or better, apply the 30 cap. Cap message and `capped` job result stay as-is.
- Feed "Setups today" counter mirrors this: counts only A+/A/B against the cap, so the number on screen matches the scanner's quota. C-Grade signals still render in the feed list.

## 3. C-Grade alerts muted

- `src/lib/scanner/alerts.server.ts`: return early for C-Grade before the recipient fan-out, so no transactional email is sent even when a user's minimum grade is C and email alerts are on.
- Browser/Android push: the realtime handler in `src/routes/_authenticated/feed.tsx` fires a `Notification` on every insert — gate it to B-Grade and above.

## 4. Global KPIs exclude C-Grade

- In `src/routes/_authenticated/performance.tsx`, derive a `coreSamples` set (samples with grade ≠ C) and feed it to the top-row KPIs (Expectancy / trade, Win rate, Avg win/loss, Total R and the rest of that grid), the natural-language insights, R-distribution and heat map.
- The "By Grade Tier" table keeps using the full sample set, so the C row still renders with its own numbers. Same for the by-instrument table.
- Add a short caption under the KPI grid noting the global math is B-Grade and above, so the tier table's C row not summing into the header is explained rather than looking like a bug.

## Technical notes

- No changes to grading, MetaApi fetching, or queue mechanics; C setups are still detected, stored, and shown.
- Cap enforcement stays central (scanner-side, `DEFAULT_DAILY_SETUP_CAP`); per-user `daily_setup_cap` remains a display/filter value as today.
- Files touched: migration, `src/lib/scanner/types.ts`, `src/lib/scanner/pipeline.server.ts`, `src/lib/scanner/alerts.server.ts`, `src/routes/_authenticated/feed.tsx`, `src/routes/_authenticated/performance.tsx`, `src/routes/_authenticated/settings.tsx`.
- Zero-Hallucination rule respected: no seeds, no placeholder rows; empty states unchanged.
