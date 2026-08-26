# Give the automatic-order bot room to actually trade

## What the ledgers show right now

Measured from `execution_enqueue_decisions` (last 4 days) and `execution_deliveries` (last 7 days):

- 370 attempts were enqueued for demo auto, so the enqueue path is working.
- ~200 attempts were refused by your intelligence gate. Most say "sample insufficient" (for example 32 filled samples, 63.1% vs your 65% threshold), i.e. the regime has not been measured enough yet — not a bad setup.
- 53 attempts hit `active_order_limit_reached` ("5 of 5 automatic orders in use today"). That ceiling counts orders placed today, so it does not free up when a trade closes.
- 313 were `session_filtered` and a handful `c_grade_*` — those are your own rules working as intended.
- At the final pre-send check the losses were `account_equity_stale` (11 refusals; the armed demo account's last broker equity reading is 13 hours old and nothing on a schedule refreshes it), `tif_expired` (old signals retried long past the window), `price_beyond_max_acceptable_entry`, and `quote_stale` (121s–662s).

Nothing here is the broker rejecting an order. Every refusal happened inside P-Trades.

## What gets built

### 1. Never miss a fill that is still valid — two mechanisms

**Retry the pending limit for the whole window.** Today a delivery that fails a market-condition check (wrong side of the entry, spread momentarily wide, quote stale, price beyond the acceptable entry) is settled as rejected and never looked at again. Instead, those specific recoverable reasons return the delivery to the queue with the attempt and reason recorded, and the minute dispatcher re-tries it on each pass until your automatic-order window ends. Non-recoverable refusals (not armed, live disabled, unmet lifecycle, risk guardrail, missing spec/grid) stay terminal exactly as now. A pullback into the entry therefore gets filled instead of being missed by 60 seconds.

**Opt-in market entry (default off).** New setting in Rules, alerts & automatic orders: "Enter at market when price has moved past the entry". When on, and price is beyond the planned entry but still inside the signal's published maximum acceptable entry, and the stop distance still passes every broker and risk gate, the order is submitted at market instead of as a pending limit. When off, behaviour is unchanged. The setting carries an explicit warning that this accepts slippage, and the resulting order is labelled in History as a market entry with the price difference against the plan.

### 2. Split the ceiling into two honest limits

- `maximum_concurrent_signal_orders` — how many automatic orders may be pending or open at the broker at once (0–10, default 3). A closed or cancelled order frees a slot immediately.
- `maximum_daily_signal_orders` — how many automatic orders may be placed per UTC day (0–25, default 10).

Both are checked; whichever binds first refuses, with a decision row naming which one. Dry runs are excluded from both, as today. Your existing value migrates into the new daily limit so nothing loosens without you choosing it.

### 3. Intelligence gate — opt-in unmeasured mode plus a real impact readout

- New setting, default off: "Allow setups whose regime has no sufficient sample". When on, the gate stops refusing purely for a thin sample; a rate that is measured and below your threshold still refuses. Orders let through this way are recorded as unmeasured on the decision row and shown as such in History, so nothing pretends to be a forecast.
- Settings gains a 7-day gate impact panel: how many automatic orders the gate blocked, split into "not enough samples" and "below your threshold", with the thresholds it compared. You can retune from evidence instead of guessing.

### 4. Keep broker equity fresh so sizing is never blocked by staleness

- A new bounded job re-reads account facts (equity, currency, free margin, trade permission) for armed accounts every 5 minutes and stores the broker's own observation time. Capped requests per run and skipped when nothing is armed.
- The fresh read immediately before sizing stays as it is; it remains the authority. The job only means the 15-minute sizing bound is normally already satisfied.
- If the broker cannot be reached, the order still refuses — no stored figure is ever treated as fresh.

### 5. Stop wasting passes on setups that can never fill

The active-signal reconciler will skip any signal already older than that owner's window (recording the expiry once, not on every pass), so `tif_expired` stops consuming dispatch capacity that valid setups need.

### 6. Deployment parity

The pending-limit geometry repair and the fresh destination-account preflight are in the code but the production refusals show behaviour from an older build. Everything above is published in one deploy and then verified against real rows before I report anything as working.

## Safety boundaries that do not move

- Real-money execution stays globally disabled. All of this affects demo automatic orders only.
- No change to grading, scanning, sizing mathematics, R accounting, lifecycle stages, replay, shadow or research statistics.
- No change to which instruments may publish or execute.
- Every new permission is per-user and defaults to today's behaviour.
- No fabricated evidence: a refused order is never counted as a broker trade, and P-Trades refusals stay labelled as P-Trades refusals, not broker rejections.

## Technical notes

- Migration: add `scanner_settings.maximum_concurrent_signal_orders` (0–10, default 3), `maximum_daily_signal_orders` (0–25, default 10, backfilled from `maximum_active_signal_orders`), `market_entry_when_passed` (bool, default false), `allow_unmeasured_intel` (bool, default false). Keep the old column readable during transition. Grants and RLS follow existing `scanner_settings` policy shape.
- `src/lib/delivery/execution.ts`: classify refusal reasons into terminal vs retryable; add `market_entry_used` / `unmeasured_intel_allowed` provenance and copy.
- `src/lib/delivery/revalidate.server.ts`: return a retry verdict for recoverable reasons; add the market-entry branch after grid snapping and before sizing, gated on the setting and on `withinMaxAcceptableEntry`.
- `src/lib/delivery/dispatch.server.ts`: requeue instead of settling on retryable verdicts, bounded by attempts and by the owner's window.
- `src/lib/delivery/direct-enqueue.server.ts` + `reconcile-active.server.ts`: dual ceiling checks, unmeasured-intel pass-through, window skip.
- New `src/routes/api/public/jobs/refresh-armed-accounts.ts` server route plus a `pg_cron` + `pg_net` job on `*/5 * * * *` using the anon `apikey` header, reusing `refreshAccountSafety` persistence.
- New server function for the 7-day gate impact aggregate off `execution_enqueue_decisions`, admin-free and owner-scoped.
- Settings UI, Guide and `/docs` updated for every new control; new unit tests for retry classification, market-entry geometry, dual ceilings, unmeasured mode and window skip; full suite, typecheck and build must pass.
