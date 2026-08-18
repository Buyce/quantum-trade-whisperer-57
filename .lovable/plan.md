# Delete trade history entries

Add deletion to the Trade History tab: remove one logged trade, or clear the whole history at once.

## What you'll see

- Each history card gets a small delete (trash) button in its header row.
- Clicking it opens a confirmation dialog naming the instrument and date; confirming removes the row immediately.
- A "Delete all history" button sits next to the export buttons in the page header, disabled when the history is empty. It opens a confirmation dialog that states how many trades will be removed and that this cannot be undone.
- After a delete, the list, performance metrics and the signal feed's taken/skipped state refresh.

Notes: deletes are permanent and only affect your own trade log — the underlying scanner signals and the shadow/learning data are untouched. Deleting a trade means that setup is no longer marked as taken, so it can be logged again if it is still live in the feed.

## Technical detail

- `src/lib/queries.ts`: add `deleteTrade({ tradeId })` and `deleteAllTrades({ userId })` using the browser Supabase client against `executed_trades` (`.delete().eq("id", ...)` / `.eq("user_id", ...)`). The existing `trades_manage_own` ALL policy already permits owner deletes, so no migration is needed.
- `src/routes/_authenticated/history.tsx`: add per-row trash button plus a header "Delete all" button, both wrapped in `@/components/ui/alert-dialog` confirmations; reuse the existing `busyId` pattern for pending state and `sonner` toasts for success/failure.
- Invalidate `["taken-trade-history"]`, `["my-trades"]`, and `["signals"]` after each delete so Performance and Feed stay consistent.
- No mock/seed data introduced; an emptied history renders the existing "NO TAKEN TRADES YET" state.
