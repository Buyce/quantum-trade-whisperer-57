# Raise automatic-order ceilings to 100 + 1-hour unresolved-order sweeper

Short answer: yes, both parts are feasible. Neither weakens a safety gate. But raising every ceiling to 100 does expose you to real broker-side limits, so the plan raises the *allowed range* to 100 and keeps your current values as defaults you choose to raise.

## Part 1 — Ceilings up to 100

Today the database and the UI cap these at:

- Automatic orders open at once: 0–10
- Automatic orders per day: 0–25
- Automatic orders per instrument per day: 0–25
- Adaptive maximum / floor: 0–25

All four ranges go to 0–100 (database check constraints, clamp constants, help text). Existing saved values are untouched; you raise them in Settings when you want.

Feasibility caveats (these are real, not blockers):

- 100 unresolved orders at once means up to 100 pending orders resting at your broker. Brokers enforce their own pending-order and margin limits; when the broker refuses, the delivery is recorded as refused with the broker's reason. Nothing breaks, but the ceiling stops being the binding limit — the broker becomes it.
- Your risk per trade, lot ceiling, exposure limit, daily setup cap, sessions, instruments and the intelligence gate all still apply on top. 100 is a ceiling, never a target.
- Dispatch processes one delivery per pass, once a minute, so a large queue drains slowly rather than firing in a burst. That is deliberate (it protects the 8-second broker call budget and the MetaApi rate limits) and is not changed here.

## Part 2 — One-hour unresolved-order expiry

New bounded worker (5-minute schedule) that clears orders which the broker never turned into a position within 1 hour, so they stop occupying your "open at once" ceiling.

Behaviour, per delivery older than 60 minutes since it was sent/queued:

- Still `pending`/`claimed` and never sent → settled `expired`, no broker call needed. Frees the slot immediately.
- Sent, resting at the broker as an unfilled pending order → we call the broker's cancel-order endpoint, and only when the broker confirms the cancellation is the delivery settled `expired`. This is the honest version of "delete the order": a P-Trades row alone cannot remove something already at the broker.
- Filled, partially filled, or otherwise already a position → left alone. Never cancelled.
- Cancellation call fails or the order cannot be found → the row stays as-is and is retried next pass. No slot is freed on an unproven cancellation, and nothing is deleted.

Rows are settled and audited, not deleted: History keeps showing what happened and why ("expired — broker did not fill within 1 hour"). Deleting them would erase the audit trail and would silently drop orders that may still be live.

The 1-hour expiry is separate from your 3-hour automatic-order window: the window governs whether a *setup* is still young enough to be ordered; this expiry governs how long an *order already at the broker* may sit unfilled.

## Technical notes

- Migration: widen `scanner_settings` check constraints (`concurrent_orders_range`, `daily_orders_range`, `per_symbol_ceiling_range`, `adaptive_ceiling_range`) to 100; keep column defaults unchanged.
- `src/lib/db-types.ts`: `CONCURRENT_ORDER_CEILING_MAX`, `DAILY_ORDER_CEILING_MAX`, `PER_SYMBOL_ORDER_CEILING_MAX` and the adaptive clamps become 100; clamp functions unchanged in shape.
- Settings UI copy updated to the new ranges.
- New `src/lib/delivery/expire-unfilled.server.ts` + `src/routes/api/public/cron/expire-orders.ts`, bounded batch, driven by pg_cron every 5 minutes; wires the existing but unused `cancelOrder` in `src/lib/metaapi/trade.server.ts`.
- New terminal delivery state/reason `expired` in `src/lib/delivery/execution.ts`; occupancy counting in `direct-enqueue.server.ts` already ignores terminal states, so freed slots are picked up automatically.
- `[INVARIANT]` tests: an unfilled resting order is only expired after a confirmed broker cancellation; a filled order is never cancelled; a failed cancellation frees no slot; ceilings clamp at 100.
- Unchanged: grading, sizing mathematics, lifecycle stages, revalidation gates, market-entry opt-in, and live (real-money) execution stays globally disabled.
