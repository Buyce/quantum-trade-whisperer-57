# Restore reliable demo automatic-order submission

## Verified diagnosis

The two screenshots show pre-broker P-Trades refusals, not broker rejections. No affected row has a submission timestamp, broker order ID, or broker return code.

1. **Stale account equity is a sequencing defect.** The armed demo account's last broker equity observation is `2026-08-25 15:31 UTC`, but automatic-order checks continued many hours later. Revalidation sizes from that stored row and rejects it at the 900-second safety limit. The code already knows how to fetch and persist fresh account facts, but it currently does so only *after* the earlier sizing check has passed, so stale equity prevents the refresh from ever running.
2. **Missing/stale price uses the wrong quote authority for direct orders.** Revalidation currently requests the canonical symbol from the shared P-Trades benchmark account before resolving the destination account. The armed account already has an exact `EURUSD → EURUSD` mapping, but that account and mapping are not used for the pre-send quote. This creates avoidable `quote_unavailable`/`quote_stale` refusals even though recent broker telemetry shows most quote reads succeeding.
3. The safety limits themselves are valid and will remain: orders must not be sized from old equity or submitted from an absent/stale quote.

## Implementation plan

### 1. Refresh the destination account before initial sizing

- Resolve the direct destination account before broker-dependent validation.
- Fetch current account information from that connected broker account, persist the latest equity/free margin/currency/trade permissions, and use the returned observation directly for initial sizing.
- Do not rely on the old database snapshot when a direct automatic order is being checked.
- Fail closed with a specific `account_refresh_unavailable` reason when the broker account refresh itself times out or refuses, instead of mislabelling the result as stale stored equity.
- Retain the existing final account refresh and final resize immediately before submission, so an equity or permission change during validation is still caught.

### 2. Revalidate price against the armed account

- For `metaapi_direct`, fetch the quote with the armed account's MetaApi account ID, region, and resolved broker symbol.
- Keep the benchmark quote path unchanged for webhook/dry-run bridge validation.
- Validate broker source timestamp, bid/ask geometry, spread, pending-limit side, and broker minimum distance exactly as today.
- Preserve `quote_unavailable` and `quote_stale` as fail-closed outcomes, but include whether the destination-account request timed out, was rate-limited, returned no price, or returned an old timestamp.

### 3. Keep the worker bounded and avoid false permanent failures

- Fetch the destination account facts and destination-account quote in one bounded preflight so independent reads do not unnecessarily consume the dispatch window sequentially.
- Never retry a mutation or an ambiguous submission. Only the existing safe bounded GET retry rules may apply.
- If preflight cannot complete, create one clear refusal/audit outcome; do not submit with cached financial inputs and do not silently loop the same delivery.
- Keep the 30-minute order time-in-force and all existing lifecycle, grade, account, risk, spread, and demo/live gates unchanged.

### 4. Add regression coverage

- Prove a stale stored equity row succeeds when a fresh broker account observation is returned, and the submitted quantity is derived from the fresh value.
- Prove a failed account refresh refuses before broker submission and never falls back to stale equity.
- Prove direct orders use the connected account's mapped broker symbol and quote, not the benchmark quote.
- Prove missing, crossed, timestamp-less, and stale destination quotes remain blocked.
- Prove the final pre-submit refresh can still cancel an order when equity, trade permission, account type, or investor mode changes after preflight.
- Prove webhook bridge behavior and real-money execution controls are unchanged.

### 5. Verify in production safely

- Run focused delivery, sizing, direct-execution, History-copy, and accounting tests, then the full suite and build.
- After publishing, confirm a fresh account observation is written during the next eligible demo attempt and that the quote observation names the armed account's mapped symbol.
- Confirm any accepted demo order receives a broker order ID/submission timestamp and then enters broker-evidence reconciliation; only closed, matched broker evidence contributes to broker wins/losses.
- Monitor account-information and quote outcomes for timeouts/rate limits. If the external broker service remains unavailable, keep refusing safely and show that exact operational cause.

## Boundaries

- Demo automatic execution only; real-money execution remains disabled.
- No relaxation of the 900-second equity bound, quote freshness, spread, pending-limit, sizing, lifecycle, or risk checks.
- No grading, signal-generation, alert, daily-cap, instrument-stage, or performance-math changes.
- No fabricated account observations, prices, submissions, broker evidence, or outcomes.
