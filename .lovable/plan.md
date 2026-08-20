# Remove the daily quota

The scanner will publish every qualifying setup it finds. No per-day ceiling anywhere: no "capped" outcome, no quota bar in the feed, no cap control in Settings.

## Scanner

- `src/lib/scanner/pipeline.server.ts`: delete the cap gate that runs after grading, along with the `countToday()` helper and the `"capped"` job status. Duplicate suppression (unique index) and the 120-minute structure cooldown stay exactly as they are — those are what stop repeat publishing, not the cap.
- `src/lib/scanner/types.ts`: remove `DEFAULT_DAILY_SETUP_CAP` and `CAPPED_GRADES` (only the cap used them).

## Feed

- `src/routes/_authenticated/feed.tsx`: remove the "Daily quota (A+/A/B) x/y" line, its progress bar, and the `todayCount`/`cap`/`capPct` computations. Keep the filter summary and "N shown" count.

## Settings

- `src/routes/_authenticated/settings.tsx`: remove the "Daily setup cap" field, its state, and the `daily_setup_cap` value sent on save.

## Data layer

- Keep the `scanner_settings.daily_setup_cap` column in place (no migration) so nothing that still selects it breaks; it simply stops being read or written by the app. `src/lib/queries.ts`, `src/lib/db-types.ts`, and the MCP scanner-status tool can keep the field exposed as inert metadata, or drop it from those selects — either way no behaviour depends on it.

## Notes

- The "No Trade" default is unchanged: grading rules still decide whether anything publishes, so removing the cap does not loosen quality — it only removes the count-based stop.
- No seeds, no placeholder rows; empty states unchanged.
