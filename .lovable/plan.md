# Safely restore and verify Demo Auto execution

## Verified current state

- Demo Auto is enabled, forced dry-run is off, lifecycle enforcement is on, and real-money execution remains disabled.
- The connected demo account is READY, CONNECTED, trade-allowed, non-investor, conflict-free, and armed as `demo_auto`.
- The dispatch worker runs every minute; active-signal and broker-evidence reconciliation each run every five minutes.
- The account has produced 27 direct automatic-order attempts, but **0 broker submissions and 0 broker order IDs**.
- Recent direct attempts were refused before the broker, principally because production sized from stale stored equity; one attempt lacked an authoritative quote. No broker rejected these rows.
- The source now refreshes the armed account and obtains its mapped destination-account quote before sizing, while retaining a second account refresh and resize immediately before submission. The focused safety suite and build are green.
- The screenshots show signals detected about seven hours earlier. They remain active for feed/journal purposes, but their automatic-order time-in-force is only 30 minutes. Submitting those old plans now would be unsafe and will remain prohibited.
- The owner’s automatic-order intelligence gate is enabled at a 37% threshold with a 30-sample minimum. Some GBPAUD signals were independently refused because only 15 filled samples were available; that gate must not be bypassed merely because the feed says “Safe to enter.”

## Implementation and release plan

### 1. Publish the repaired direct-order preflight

- Deploy the existing fresh-equity and destination-account quote repair.
- Keep real-money execution disabled and keep direct demo rows non-dry-run.
- Do not replay or resubmit any historical refused delivery.

### 2. Verify one fresh demo canary end to end

For the next newly detected signal that is under 30 minutes old and passes the user’s instrument, session, grade, intelligence, lifecycle, account, capacity, risk, spread and broker-geometry gates:

1. Confirm one idempotent `metaapi_direct` delivery is created for the armed demo account.
2. Confirm preflight writes a fresh broker account observation and uses the account’s mapped broker symbol and quote.
3. Confirm sizing uses that fresh equity and the final pre-submit refresh can still cancel or resize safely.
4. Confirm a successful submission records `submitted_at`, submitted volume/prices, the broker result and broker order ID.
5. Confirm broker-evidence reconciliation subsequently classifies the order as open/closed; only closed, positively matched evidence contributes to broker wins/losses.

If the broker account or quote request times out, keep the order blocked and surface the exact operational reason. Do not fall back to cached equity or benchmark pricing.

### 3. Make feed validity and automatic-order eligibility unambiguous

- Preserve the existing manual signal lifecycle, but stop presenting an old card’s “Safe to enter” or “At entry” state as if it still authorizes automatic submission.
- On signals older than the 30-minute automatic-order window, show a distinct **Auto-order window expired** state while retaining the factual manual/feed state.
- On fresh signals excluded by the intelligence gate, show the recorded gate reason, including threshold and sample sufficiency, rather than implying the bot malfunctioned.
- Keep “active signal,” “manual entry state,” and “automatic-order eligible now” as three separate concepts in UI copy and Guide documentation.

### 4. Add production observability for Demo Auto

- Add a concise status summary for the armed demo account: last decision, last direct attempt, last fresh account observation, last quote result, last broker submission, and current blocking gate.
- Distinguish clearly between queued, refused by P-Trades before broker, submitted to broker, broker-open and broker-closed.
- Avoid blanket claims when no fresh eligible signal exists; report only the latest recorded decision.

### 5. Verification boundaries

- Run focused enqueue, revalidation, direct-submit, History/feed-copy, evidence and performance tests, then the full test suite and build.
- Do not relax the 30-minute TIF, 900-second equity freshness, quote freshness, intelligence gate, spread, pending-limit side/distance, sizing, margin, lifecycle, capacity or risk controls.
- Do not auto-submit the seven-hour-old screenshot signals, fabricate a canary, promote instruments, alter grading, or enable real-money execution.

## Safe mitigation answer

Yes: publishing the fresh broker preflight and observing the next genuinely fresh eligible demo signal is safe. Retrying historical signals or weakening the safety gates is not.
