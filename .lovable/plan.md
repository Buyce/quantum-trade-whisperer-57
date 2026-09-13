# Fix the training data export in Admin

## What is wrong

Confirmed against the live database, not guessed:

- The two database reads behind the export card exist (`count_training_dataset`, `read_training_dataset`) and hold the correct owner check.
- That owner check identifies you by your signed-in email address.
- The export card, however, asks the database through the system service account, which has no email address attached. The check therefore says "not the owner" and every dataset count fails — which is exactly the red "Could not read the dataset inventory." line in your screenshot.

So nothing is missing from the data or the database: the card is simply knocking on the door as the wrong caller. The team AI tools (`describe_datasets`, `read_dataset`) already ask as the signed-in owner, so they are unaffected.

## The fix

1. Have the export card's counts and row reads run as the signed-in owner instead of the system account, so the existing owner check passes. The owner-only rule stays enforced in two places (in the app and again inside the database).
2. Keep every other guarantee unchanged: account identifiers stay withheld in the database, only real recorded rows are returned, and an empty date range still downloads an empty file with a row count of zero.
3. Show a clearer message if a read ever fails again, naming the reason instead of a generic line.
4. Verify by loading Admin → Intelligence and confirming real row counts appear for each of the eight datasets, then downloading one set in both formats.

## Technical notes

- `src/lib/datasets/datasets.functions.ts`: replace the `adminClient()` service-role calls in `getDatasetInventory` and `readDataset` with `context.supabase` from `requireSupabaseAuth`. Both RPCs are `SECURITY DEFINER` with `EXECUTE` already granted to `authenticated`, so row visibility is unchanged; `is_admin()` then resolves from the caller's JWT email. Keep the existing `ownerOnly(context.claims)` guard.
- Counts are currently fetched one dataset at a time in a loop; issue them with `Promise.all` so the panel loads in one round trip.
- `DatasetExportPanel.tsx`: surface the returned error message on inventory failure.
- No migration, no schema change, no change to the MCP dataset tools.
- Verification: `bunx vitest run src/lib/datasets`, typecheck, build, then a signed-in browser check of the panel.
