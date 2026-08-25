# Stop noisy P-Trades order blocks and make automatic-order stats explicit

## Current evidence

- In the last 24 hours, the delivery ledger shows many `metaapi_direct` demo-auto rows with `dry_run=false` but `state=rejected` before submission.
- The largest current blocker is `tif_expired`: 17 recent demo-auto rows were refused because the setup was older than the 30-minute order window before dispatch.
- The next blocker is historical `price_beyond_max_acceptable_entry`: 6 recent demo-auto rows came from the old pending-limit validation bug already fixed in source but needing the live path to run the corrected code.
- Smaller blockers are `account_equity_stale` and `quote_stale`; those are valid fail-closed safety checks when broker/account data is not fresh enough.
- All recent rejected groups inspected have no broker return code and no `submitted_at`, so they did not reach the broker.
- `broker_trade_evidence` currently has 0 rows, so the Performance “Broker Account” source has no broker-verified automatic wins/losses yet.

## What this means

P-Trades is blocking many rows because the active-signal reconciler is now retrying still-active database signals that are already too old to be legally sent as pending orders. The dispatcher correctly refuses them as expired, but the system should not keep creating delivery rows for signals that are already outside the 30-minute execution window.

For statistics: an automatic order should not be counted as a win or loss just because it was attempted. It should count as broker-account performance only after all of these are true:

1. P-Trades submitted or the broker acknowledged the order.
2. The broker evidence reconciler positively matched the broker order/deals back to the P-Trades delivery.
3. The broker position/order is closed and has a valid R value for the selected R basis.

Blocked P-Trades checks and dry-run webhook validations should remain audit rows, not taken trades.

## Plan

### 1. Stop stale active signals from becoming new delivery rows

- Add an execution-window check before direct enqueue in both publication retry/reconciliation paths.
- If a signal is older than `ORDER_TIF_MINUTES`, do not create an `execution_deliveries` row.
- Record a clear `execution_window_expired` enqueue decision instead, so the user still sees why no order was placed.
- Keep dispatcher-side `tif_expired` as the final safety net for rows that were fresh at enqueue but became stale before dispatch.

### 2. Clean up already-stale active signals safely

- Mark existing active signals older than the execution window as no longer entryable using existing signal expiry/status fields only.
- Do not alter historical prices, grades, outcomes, replay rows, broker rows or performance stats.
- Do not fabricate broker submissions or outcomes.

### 3. Keep valid safety refusals, but make them easier to read

- Keep `quote_stale` and `account_equity_stale` as hard stops; these protect against trading from stale broker facts.
- Surface them in History/Settings as P-Trades safety checks, not broker rejections.
- Add concise copy for: expired execution window, stale quote, stale account equity, and pending-limit side validation.

### 4. Make automatic-order performance accounting explicit

- Add an “Automatic broker orders” summary to Performance or History that separates:
  - attempted automatic checks,
  - blocked by P-Trades before broker,
  - submitted/passed to broker,
  - broker open,
  - broker closed,
  - closed wins/losses by signed R.
- Use `execution_deliveries` for attempt/submission counts and `broker_trade_evidence` for broker-confirmed outcomes.
- Do not mix these with the self-reported “My Journal” population.

### 5. Ensure broker-passed automatic orders enter win/loss stats correctly

- Confirm the existing Broker Account Performance source reads customer `broker_trade_evidence` closed rows.
- Add tests proving closed automatic broker evidence becomes a Performance sample and contributes to win/loss, expectancy, total R and by-grade tables.
- Add tests proving rejected-before-submit and dry-run rows do not enter win/loss stats.

### 6. Verify the worker chain end to end

- Verify the scheduled active-signal reconciler exists and is active.
- Verify the dispatch worker drains pending direct deliveries.
- Verify the broker-evidence reconciler runs after broker submission and writes evidence only from broker-confirmed data.
- Keep real-money execution disabled. Demo-auto can submit only to armed demo accounts after all gates pass.

## Technical notes

- `src/lib/delivery/reconcile-active.server.ts`: filter out signals older than `ORDER_TIF_MINUTES`; record an enqueue decision instead of creating delivery rows.
- `src/lib/delivery/direct-enqueue.server.ts`: add an early execution-window guard so every caller gets identical behaviour.
- `src/lib/delivery/enqueue-log.ts`: add user-facing copy for the new decision code.
- `src/lib/history/broker-orders.ts` and `src/components/history/AutomaticOrders.tsx`: keep the P-Trades-vs-broker distinction for all refusal states.
- `src/lib/performance.ts`, `src/lib/performance-evidence.server.ts`, and Performance UI/tests: prove automatic broker evidence counts only after closed broker evidence exists.
- Database cleanup: use a data update, not a schema migration, for already-expired active signals if the code audit confirms the existing status/expiry fields are the right place.

## Safety boundaries

- No live/real-money execution enablement.
- No Wave 1/Wave 2 lifecycle promotion.
- No grading, sizing, signal generation or alert-threshold changes.
- No mock broker evidence, no sample trades and no fabricated win/loss rows.
- A missing broker outcome remains missing until broker evidence exists.
