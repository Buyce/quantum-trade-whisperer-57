# Plan: Shadow replay engine repair

## What the audit confirmed

- The replay queue is not backed up: all `shadow_queue` jobs are done/enrolled.
- The production replay set has 484 resolved rows and 1 open EURUSD row.
- The replay engine is not paused, but its last run recorded `All instrument candle fetches failed` and 1 consecutive failure.
- Production server logs show a live provider timeout pattern across scanner candle reads, for example `MetaApi request for ... exceeded 8000ms and was aborted`.
- The shadow resolver currently fetches up to 1000 M15 candles in one provider call per open production instrument. The live scanner uses much smaller batches: H4/H1 300 and M15 200.
- The Admin tile labels shadow replay as `RUNNING` whenever the breaker is not paused, even when the latest replay pass failed.

## Goal

Make shadow replay resilient and truthful without fabricating candles, backfilling outcomes, changing grading, changing lifecycle stages, or touching live execution.

## Implementation steps

1. **Reduce replay candle fetch pressure safely**
   - Replace the fixed 1000-candle replay batch with bounded windows derived from the open rows that need resolution.
   - Keep enough candles to cover the replay horizon, but do not request excessive history for a row whose cursor is already near the current market.
   - Keep one fetch per instrument per pass; do not add candidate/research fetches.

2. **Preserve replay correctness on missing candles**
   - If the provider times out or returns no usable candles, leave the row open and keep its replay cursor unchanged.
   - Do not mark the setup as loss, win, expired, no-trade, or never-filled from missing data.

3. **Record more useful replay failure detail**
   - When all instrument fetches fail, store a concise per-instrument reason instead of only the generic message.
   - Keep provider error text sanitized and bounded.
   - Surface whether the last replay pass scanned rows but fetched zero candles.

4. **Fix the Admin status semantics**
   - Add a replay-health classifier separate from the live scanner classifier.
   - Show `DEGRADED` when the last replay run failed but the breaker is not paused.
   - Show `RUNNING` only when the latest replay pass did not record a current error.
   - Keep `BREAKER TRIPPED` for paused/cooldown state.

5. **Fix provider-observation vocabulary drift**
   - Align the code-side observation outcomes with the database constraint so 429/auth observations are recorded instead of silently discarded.
   - This improves future diagnostics without changing trading behaviour.

6. **Tests and documentation**
   - Add unit tests for replay fetch sizing, all-fetch-failed summary detail, cursor preservation, and Admin replay status labels.
   - Update the operations/research docs to explain: provider timeout means unresolved replay data, not a replay-calculation result.

## Non-goals / safety locks

- No generated candles, no synthetic shadow outcomes, no seed rows.
- No promotion of Wave 1 or Wave 2 instruments.
- No alert, MCP, demo-order, or live-order side effects.
- No change to ABC grading, C-grade permissions, sizing, or execution controls.

## Expected result

The open EURUSD replay row will remain unresolved until real M15 candles can be fetched, but the engine will avoid unnecessarily heavy replay fetches and the Admin tab will report the exact state: provider data unavailable/degraded rather than implying the replay math itself produced a result.
