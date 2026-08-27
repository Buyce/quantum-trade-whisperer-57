# Repair fill accounting and improve automatic-order fill rate

## Verified audit findings

### Signal feed

- The uploaded feed contains **167 broker-derived signals**: 87 B, 79 C and 1 A; 134 are active and 33 expired.
- It contains only the three execution-approved instruments: EURUSD, GBPAUD and XAUUSD.
- **148 of 167 signals are SHORT.** Every one of the 27 broker-accepted automatic orders is also SHORT, so this sample is strongly one-directional and is not evidence of general long/short fill performance.
- No grading formula defect was found in this audit. The feed is publishing repeated fresh structures as price trends; the already-built one-resting-order-per-setup guard must remain so repeated cycles cannot multiply the same risk.

### Automatic-order history

- The uploaded history contains **72 rows**: 27 accepted/resting, 38 not sent by P-Trades, 5 broker rejections and 2 unknown submissions.
- The live ledger confirms 27 acknowledged broker orders with broker order IDs and `TRADE_RETCODE_DONE`, but `broker_trade_evidence` contains **zero rows**.
- Accepted means the broker accepted a pending sell-limit order; it does not itself prove a fill. Seven of the newest accepted orders had not reached their entries in the available quote samples.
- However, the available 15-minute broker telemetry crossed the executable sell-limit price for **20 of the 27** accepted orders (EURUSD 7/7, GBPAUD 5/10, XAUUSD 8/10). This is not tick-level proof of a fill, but it disproves the current blanket presentation that price never reached every entry and requires broker-history reconciliation.
- The reconciliation worker is scheduled every five minutes, but production logs show repeated HTTP 500 failures: `actual entry and exit prices must be supplied together or not at all`.
- Root cause: an entry-only broker deal is correctly summarized as an open position, then passed to the closed-trade R validator with an actual entry and null exit. The validator throws before the evidence row is written, aborting the reconciliation pass. Therefore **the displayed “0 filled / 0 open” is currently not reliable**.
- The owner already enabled market entry and a six-hour order window. The current market-entry branch only runs after price has crossed the planned limit; when price is still on the resting-limit side, it always submits a pending limit. That behavior does not implement the selected “immediate market entry” policy.

## Implementation

### 1. Repair broker fill and open-position reconciliation first

- For broker-confirmed open positions, persist the real entry, volume, broker position/order identifiers, held stop and timestamps while asking R math for an explicit `unavailable_open` result without supplying a fabricated exit.
- Keep closed-trade R unchanged: actual entry and actual exit remain mandatory, and R remains broker-derived.
- Isolate each associated deal group so one malformed broker record is reported and skipped without aborting every other account/order in the reconciliation pass.
- Preserve positive association by P-Trades client ID and magic; never infer fills from sampled quotes, proximity or time.
- Add regression tests for entry-only open positions, open-to-closed updates, malformed isolated groups and a mixed reconciliation batch.
- Let the next scheduled reconciliation backfill real open/closed evidence from broker history. Do not insert synthetic evidence or rewrite delivery audit rows.

### 2. Make History and Performance truthful

- Show **Resting at broker** only when the latest broker reconciliation confirms no associated entry deal; do not claim “price has not reached entry” from the absence of evidence.
- Once an entry deal is matched, show **Open at broker** with actual broker entry and volume; once exit deals fully close the volume, show **Closed at broker** and canonical R.
- Add reconciliation health to automatic-order accounting: last successful pass, failed pass/reason and orders awaiting evidence, so a broken evidence worker cannot look like zero fills.
- Keep submitted, resting, open, closed, expired, broker-rejected, P-Trades-refused and unknown as separate counts. Only broker-confirmed closed evidence contributes to wins/losses.
- Correct export wording: a broker-null resting row has no confirmed fill yet; it must not say “Trade is still open.”

### 3. Implement the selected immediate-market policy

When `auto_market_entry_enabled` is on, the first dispatch will prefer a market order instead of placing a resting limit, provided the destination quote is inside the signal’s published maximum acceptable entry.

For every immediate market order, P-Trades will still:

- fetch a fresh destination-account quote and equity;
- require a fresh account specification and broker price grid;
- enforce the published maximum acceptable entry without widening it;
- keep the original stop and TP1, require valid direction geometry and broker minimum-stop distance;
- recompute risk distance and position size from the live market price;
- re-run spread, quantity, margin, lifecycle, session, grade, daily/concurrent/per-symbol and account-arming gates;
- attach stop loss and TP1 in the same broker request;
- record entry mode, published entry, submitted market reference and price difference for audit/history.

If the live quote is outside the maximum acceptable entry or any safety check fails, no market order is sent. There is no fallback that chases price beyond the published setup.

### 4. Align settings and copy with the real policy

- Rename the control from language implying “only after price passes entry” to **Enter eligible orders immediately at market**.
- Add a concise warning that this improves fill probability but changes the measured pending-limit strategy and may accept slippage within the published boundary.
- Label every automatic order as `Market entry` or `Pending limit` in History and exports.
- Existing users who have the toggle off remain pending-limit only. The audited owner already has it on, so the new semantics apply after deployment without silently enabling another user.

### 5. Measure fill quality, not just fill count

Add a broker-derived fill funnel by instrument, grade and entry mode:

```text
eligible → sent → broker accepted → filled/open → closed
                         ↘ expired unfilled
```

Track:

- acceptance-to-fill rate and time-to-fill;
- pending-limit expiry rate;
- market-entry price difference in R units;
- realised R versus plan and versus actual broker-held risk;
- P-Trades refusal and broker-refusal reasons separately.

Do not optimize on fill rate alone. Market entry is considered beneficial only if broker-confirmed expectancy and risk-adjusted outcomes remain acceptable; no grade, alert or research statistic is silently redefined.

## Validation and rollout

1. Unit-test reconciliation and immediate-market selection/boundaries.
2. Run the full test suite, lint, typecheck and build.
3. Deploy the reconciliation repair first and verify real evidence rows appear for positively matched broker deals.
4. Deploy immediate-market semantics with live execution still globally disabled and demo auto only.
5. Verify on the armed demo account that a qualifying new signal produces one market request with attached stop/TP1, correct resized volume and no duplicate resting order.
6. Monitor the broker-derived funnel by instrument and grade; retain the ability to switch back to pending-limit mode immediately.

## Safety boundaries

- No changes to signal detection, grading, alert eligibility, lifecycle promotion, replay, shadow or research models.
- No fabricated fills, prices, outcomes or evidence; quote samples remain diagnostic only.
- No increase to risk percentage, order ceilings or approved instruments.
- No live-account execution; global live execution remains disabled.
- No automatic resubmission of unknown/sent requests, and no deletion of audit history.
