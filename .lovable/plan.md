# Why the demo account got no orders — and what to do about it

## What the ledger actually shows

Your demo arming is fine. Two broker-confirmed DEMO accounts are READY, trade-allowed,
non-investor and armed to Demo Auto, Demo Auto is ON and forced dry-run is OFF.

Three separate things happened:

1. **Real demo orders WERE queued, then refused by P-Trades before sending.**
   Six deliveries today went to the two demo accounts with `dry_run = false`
   (destination `metaapi_direct`, 17:46, 18:16, 18:30). Every one was refused with
   `price_beyond_max_acceptable_entry` — the exact defect fixed in the last change
   (buy-limit entries were compared against a market-chase ceiling). **That fix is in
   the repository but has not been published**, so production is still running the old
   check.
2. **The "Dry run · not sent to a broker" cards are not the demo path.** Those are
   your outbound webhook bridge deliveries (`destination_type = bridge_json`), which
   are correctly dry-run because real-money execution is OFF system-wide. They are a
   separate destination from the demo account and will never place a demo order.
3. **The 19:00 and 19:15 XAUUSD setups produced no demo delivery and no decision row
   at all** — only the bridge row created by the database trigger. Why the demo path
   did not run for those two cycles is not yet established, and there is currently no
   retry: the active-signal reconciliation worker exists in the code but is **not
   scheduled**, so a setup missed at publish time is never retried.

## What I will do

### 1. Publish the pending-limit fix (unblocks the demo path)
Nothing in the demo path can succeed until the corrected pre-send validation is live.
This is the single biggest cause of "no order on the demo account".

### 2. Schedule the active-signal reconciler
Add a bounded pg_cron job calling `/api/public/worker/reconcile-active` (every 5
minutes) so any still-active, still-eligible setup gets a second attempt through the
same authoritative gate stack. It creates no new rules and cannot bypass pre-send
revalidation.

### 3. Stop dry-run webhook rows from spending the demo order ceiling
The concurrent-order ceiling currently counts every delivery in an occupying state,
including dry-run webhook rows that never reached a broker. Count only rows that can
actually hold a broker order, so a webhook dry-run cannot silently block a demo order.

### 4. Make the missing-decision case impossible to read as silence
Record a decision row whenever the publish-time demo enqueue cannot complete, and
surface in Admin whether the last cycle's automatic-order attempt was recorded, so a
gap like 19:00/19:15 shows itself instead of looking like "nothing qualified".

### 5. Honest labels in History
Distinguish the demo-account destination from the webhook bridge on each card, so a
webhook dry-run is never mistaken for the demo account doing nothing.

## Boundaries

Live/real-money execution stays OFF. No grading, sizing, alert, cap or lifecycle
change. No instrument promotion. No fabricated rows — historical deliveries are left
exactly as recorded.

## Technical notes

- Cron job mirrors the existing `worker/dispatch` job shape (cron secret header,
  bounded timeout); the route already bounds itself to 25 signals per pass.
- `occupiedOrderCounts` in `src/lib/delivery/direct-enqueue.server.ts` gains a
  destination/dry-run filter, with the fail-closed unreadable behaviour unchanged.
- Publish-time enqueue in `src/lib/scanner/pipeline.server.ts` records a
  `enqueue_attempt_failed` decision in its catch path for the demo path specifically.
- Tests: ceiling excludes dry-run bridge rows; reconciler enqueues a previously missed
  active signal; History labels demo vs bridge destination.
