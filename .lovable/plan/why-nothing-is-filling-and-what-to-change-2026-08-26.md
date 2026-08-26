# Why nothing is filling — and what to change

## What the live data actually shows (verified just now)

Nothing is broken at the broker. Orders are reaching it and being accepted.

- 38 automatic orders were submitted to the broker today; 17 are still accepted and resting, all with real broker order IDs and `TRADE_RETCODE_DONE`.
- Every one of them is a **pending limit for a short**, so it only fills if price trades back **up** to the entry. Latest broker quotes versus the resting entries:
  - EURUSD 1.16513 vs limits at 1.16544 (about 3 pips above price)
  - XAUUSD 4594.39 vs limits between 4600.87 and 4609.21
  - GBPAUD 1.89513 vs limits between 1.89661 and 1.89675
  Price moved down and away, which is the trade's direction — the setups simply never pulled back into the entry. That is a genuine no-fill, not a defect.
- `broker_trade_evidence` is empty and Performance therefore shows 0 open / 0 closed. That is correct: no order ever became a position, so there is no broker evidence to count. Nothing is being hidden or substituted.

## Two real problems the same data exposes

**1. Duplicate stacking on one setup.** The same structure republishes each 15-minute cycle with the identical entry, and every republish becomes another live broker order. Right now: 6 EURUSD sell limits all at exactly 1.16544 totalling 67.86 lots, 3 GBPAUD totalling 24.4 lots, 8 XAUUSD. If price ever touches 1.16544, all six EURUSD orders fill together — roughly six times the risk you sized for. This is the most serious finding on this page.

**2. The 3-hour window is really a 1-hour window.** The broker order carries your 3-hour automatic-order window as its expiration, but the unfilled-order sweeper cancels any resting order after a fixed 60 minutes. So a setup you allowed 3 hours to fill gets pulled after 1 hour.

## What gets built

### 1. One live order per setup (stops the stacking)

Before enqueueing, refuse when the same owner already has an untouched, resting or in-flight automatic order for the same instrument and direction whose entry is within one broker tick of the new plan's entry. The refusal is recorded as a decision row (`duplicate_resting_order`) naming the existing delivery, so History and the decisions panel explain it. Filled, cancelled and expired rows never block anything. Genuinely different entries on the same instrument still stack up to your per-instrument ceiling, exactly as today.

### 2. The window is the window

The sweeper stops using a fixed 60 minutes and uses each owner's `auto_order_window_minutes` (with the existing fixed fallback when it is unreadable). A 3-hour window then means the order rests for 3 hours, matching the expiration already sent to the broker. Cancellation rules do not loosen: only a broker-confirmed cancellation of an untouched order settles the row `expired`; anything filled, partially filled, unreadable or refused is left alone and re-examined.

### 3. Say "resting", not just "accepted"

- History: an accepted order with no fill is labelled **accepted by broker — resting, not filled yet**, with how far price currently sits from the entry and when the order expires.
- Performance delivery accounting gains a **resting at broker** count between "submitted" and "broker open", so 23 submitted / 0 open reads as 17 still waiting rather than looking like a failure. Win/loss counting is untouched — still closed, positively associated broker evidence only.

## Boundaries

- No change to grading, signal generation, sizing mathematics, R accounting, lifecycle stages, replay, shadow or research.
- No relaxation of any safety gate; the dedupe check is an additional refusal, not a permission.
- Real-money execution stays disabled; this is demo automatic orders only.
- No fabricated fills, positions or broker evidence — a resting order stays a resting order until the broker says otherwise.

## Technical notes

- `src/lib/delivery/direct-enqueue.server.ts` and `reconcile-active.server.ts`: shared `hasRestingDuplicate` check against non-terminal `execution_deliveries` for the same `user_id`/instrument/direction with `|published_entry - entry| <= tick`; new decision reason in `enqueue-log.ts` and `execution.ts` copy.
- `src/lib/delivery/expire-unfilled.server.ts`: `isUnfilledTooLong` takes a per-owner timeout; the sweeper joins `scanner_settings.auto_order_window_minutes` for the rows it examines. `UNFILLED_ORDER_TIMEOUT_MS` stays as the fallback.
- `src/components/history/AutomaticOrders.tsx` and the delivery-accounting summary (`automatic-order-summary.ts`) gain the resting classification and count.
- New unit tests: duplicate detection inside/outside one tick, opposite direction and terminal rows not blocking, per-owner sweep timeout, resting classification in the summary. Full suite, typecheck and build must pass; ship in one deploy.
