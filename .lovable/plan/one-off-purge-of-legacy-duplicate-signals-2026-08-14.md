# One-off purge of legacy duplicate signals

## What we found

- `scanned_signals` holds 154 rows; 153 of them are legacy (no `structure_key`), i.e. created before structure-based deduplication went live.
- The feed is dominated by near-identical repeats: e.g. EURUSD long republished every 15 minutes for hours with stop losses drifting by a fraction of a pip.
- With the requested rule (same instrument + direction, within 120 minutes, entry or stop within 0.05%), roughly 134 legacy rows are duplicate followers. The exact number will come from the run, because the cleanup keeps the earliest row of each cluster and re-anchors from the next survivor.
- `executed_trades` currently has 7 rows, all "taken". Their signals are excluded from deletion.

## Cleanup rules

- Only rows with `structure_key IS NULL` (legacy) are eligible; anything produced by the new deduplicated pipeline is untouched.
- Cluster walk per instrument + direction, oldest first: keep the earliest row, delete every later row within 120 minutes of it whose entry price OR stop loss is within 0.05%, then re-anchor on the next surviving row and repeat.
- Never delete a signal referenced by a "taken" trade in the journal. Such a row is kept and also used as a cluster anchor so its neighbours still collapse.
- Child rows in `market_context` for deleted signals are removed first; any "skipped" trade rows attached to a deleted signal are removed too (skipped decisions are not retained by existing policy).
- Distinct setups (different instrument, direction, outside the 120-minute window, or outside the 0.05% band) are left alone. No rows are inserted or modified — deletion only.

## Technical approach

1. Migration that defines a one-off `plpgsql` block (a `DO` block, so nothing lingers in the schema):
   - Iterate legacy signals ordered by `instrument, direction, created_at`.
   - Maintain the current anchor per (instrument, direction); mark rows matching the anchor within the window/variance as duplicates, otherwise promote them to anchor.
   - Collect duplicate ids, then delete in FK-safe order: `market_context` -> `executed_trades` (skipped only) -> `scanned_signals`.
   - Raise a notice with the deleted count.
2. Verify with a follow-up read query: remaining row count, remaining legacy count, and confirmation that all 7 taken-trade signals still exist.
3. Cache refresh: after the purge, `signalsQuery` results are refetched so `/feed` and `/performance` render the cleaned state. Both pages already subscribe to signal changes; a small explicit invalidation of the `["signals"]` query key on mount is added if the pages do not already refetch on focus.

## Out of scope

- No change to grading, the scanner pipeline, retention windows, the hourly `purge_expired_signals()` job, or any UI logic beyond the cache invalidation.
- No seeded, mock, or replacement rows of any kind.
