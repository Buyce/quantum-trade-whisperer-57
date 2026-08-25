# Fix: scans are running, but results can't be saved

## What the database actually shows

The scheduler is not broken. Jobs were enqueued at 09:15, 09:00, 08:45, 08:30, 08:15, 08:00 — exactly every 15 minutes — and the worker picked each one up within seconds. Both `pg_cron` and `pg_net` are enabled and the security gate is passing.

The amber indicator is real, but it is pointing at a different problem: the scan runs, then **fails when it tries to write anything back**. Evidence from the last several hours:

- Every XAUUSD and GBPAUD job ends as `failed` with the error text `[object Object]` (a database error whose real message was thrown away instead of logged).
- `instrument_health.updated_at` for all three pairs is frozen at 04:01 — the heartbeat timestamp the UI reads is never refreshed.
- `scanned_signals` has 0 rows, and no signal has ever been recorded, because the write that publishes a graded setup is malformed.

## Root causes (three separate column mismatches)

1. **Heartbeat write targets a column that doesn't exist.** The scanner marks an instrument healthy/unhealthy by writing `checked_at`, but the table's timestamp column is `updated_at`. Every one of those writes is rejected, and the rejection is ignored — so the "last scanned" time never moves, which is exactly what the fail-safe caught.
2. **Signal publish writes a non-existent link column.** The scanner inserts `market_context_id` onto the signal row, but the relationship runs the other way: the context row carries `signal_id`. So any pair that produces a valid setup fails instead of publishing. EURUSD only looks healthy because it keeps grading as "No Trade" and never reaches this write.
3. **Market context is inserted before the signal exists.** `market_context.signal_id` is required, but the current order creates context first with no signal to point at — so it can never succeed.

## The fix

1. Reorder the publish step in the scanner pipeline: insert the signal row first, then insert its market-context row with `signal_id` set to the new signal. Drop the bogus `market_context_id` field.
2. Change the instrument-health writes to set `updated_at`, and stop silently swallowing their result — if the heartbeat write fails, log it.
3. Fix error reporting so a database error is recorded with its real message and code instead of `[object Object]`. This alone would have surfaced the cause hours ago.
4. Add a **"Run scan now"** control in Settings (visible to signed-in users) that triggers a scan cycle and reports back what happened per instrument — enqueued, published, no-trade, or failed with the reason. It calls a small authenticated server function, so no secret is exposed in the browser.
5. Leave the schedule itself alone: it is firing correctly. No cron job will be dropped or recreated.

## Verification before I report back

- Trigger a cycle manually and confirm the three jobs move to `done`.
- Confirm `instrument_health.updated_at` advances to the current time for all three pairs.
- Confirm a graded setup, when one occurs, lands in `scanned_signals` with a matching `market_context` row.
- Confirm no job ends with an `[object Object]` error.

## Technical notes

- Files touched: `src/lib/scanner/pipeline.server.ts` (insert order, health column, error serialization), a new server function for the manual trigger, and `src/routes/_authenticated/settings.tsx` for the button.
- No schema migration needed — the tables are correct; the code was writing to the wrong shape.
- The Zero-Hallucination rule is preserved: nothing is seeded, and "No Trade" cycles continue to render the empty state.
- Intermittent MetaApi `504` responses (seen at 08:45) are upstream broker hiccups already handled by the graceful skip path; they are unrelated to these bugs.

&nbsp;

The investigation and fix plan are APPROVED! Please execute the plan immediately:

1. In `src/lib/scanner/pipeline.server.ts`:

   - Fix the pipeline insertion order: Insert `scanned_signals` first, then insert `market_context` with the returned `signal_id`. Remove the invalid `market_context_id` field.

   - Update `instrument_health` writes to use the correct `updated_at` column name, and log any database errors cleanly.

   - Properly serialize all database error objects so error codes and messages are logged instead of `[object Object]`.

2. In `src/routes/_authenticated/settings.tsx`:

   - Add the "Run scan now" manual trigger button (calling the new server function) so I can verify scan execution on demand.

3. Run a manual scan test immediately after the fix to confirm:

   - All three jobs complete with status `done`.

   - `instrument_health.updated_at` advances to the current timestamp.

   - The amber UI warning converts back to a green heartbeat.
