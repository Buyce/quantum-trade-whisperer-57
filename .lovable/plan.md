# Cut "Not sent — refused by P-Trades" waste

## What the data shows (verified in production just now)

Refusals are not random — they concentrate in a few reasons, and almost all of them are caused by **queue latency and blind retrying**, not by bad signals.

Rejected deliveries, all time:

| Reason | Count | Avg time queued before refusal |
|---|---|---|
| price ran beyond max acceptable entry | 75 | 104 min |
| account/broker spec unavailable | 51 | 91 min |
| automatic-order window expired (TIF) | 26 | 224 min |
| market closed | 9 | 177 min |
| quote stale | 3 | 112 min |

Three concrete defects behind those numbers:

1. **A single order can monopolise the worker.** Delivery 11317 (XAUUSD, queued 03:35) has been re-asked **84 times** — the dispatcher re-tries it about 5 times every minute because `price_beyond_max_acceptable_entry` is on the retryable list with **no backoff**. Every attempt spends a broker quote call and worker time on an order the price has already left behind.
2. **Head-of-line blocking.** The claim rule always takes the single most urgent pending row, so while 11317 churned, delivery 11470 sat **pending for 90+ minutes with 0 attempts** and 16 rows are pending right now, the oldest from 03:35. Fresh setups age out (TIF expired, price gone) waiting behind a stuck one.
3. **Refusals are discovered too late.** Market-closed, spec-unavailable and window-expired are all knowable at *enqueue* time, but they are only checked at dispatch — after the row is created, counted against limits, and shown to you as a queued order that later flips to "Not sent".

Separately, at enqueue the biggest volume reasons are user-policy, not failures: C-grade blocked (1451), session filtered (724), concurrent limit (346), duplicate resting (37 + …). Those are correct refusals and stay.

## What to change

### 1. Backoff and terminal give-up on price gates
- Add `next_attempt_at` to `execution_deliveries`; the claim RPC only considers rows where it is null or in the past.
- On a retryable refusal, set `next_attempt_at` with escalating spacing (1, 2, 5, 10 min, then 15 min ceiling) instead of retrying every pass.
- Terminalise early instead of grinding: if the market has moved beyond the entry ceiling by more than a configurable multiple of the setup's risk distance, refuse once as `price_beyond_max_acceptable_entry` and stop — a setup that far gone is not coming back inside tolerance.
- Lower the retry ceiling from 120 attempts to a value consistent with the window (attempts stop when the remaining TIF is shorter than the next backoff step).

### 2. Fair, batched claiming
- Claim a **batch** per pass (round-robin across users/instruments) rather than one row repeatedly, so a hot symbol cannot starve everything else.
- Skip rows whose remaining window is shorter than one dispatch cycle and settle them as expired immediately, rather than claiming them just to refuse them.

### 3. Move cheap checks to enqueue time
Refuse before a delivery row is ever created when:
- The market for that instrument is closed (or the weekend gate is on).
- The broker/account spec needed for sizing is missing or stale, and an on-demand refresh fails — with the existing daily refresh already run first.
- The remaining automatic-order window is below a minimum useful floor.

These become `execution_enqueue_decisions` rows with the same clear reason, so the audit trail is unchanged — you see *why* nothing was queued, without a phantom queued order.

### 4. Make the cost visible
- Admin panel: refusal reasons for the last 24 h / 7 d, with attempts spent and average queue latency per reason, so a regression like 11317 is obvious within a cycle instead of a day later.
- Trade History: refused rows show attempts spent and the terminal reason.

### 5. One-off cleanup
Settle the current 16-row backlog: expire what is past its window, apply the new backoff to the rest.

## Notes

- No change to grading, sizing authority, or the live-execution lock. Live execution stays globally disabled.
- Enqueue gates only ever *reduce* what is sent; every existing downstream gate stays in place and still re-checks at dispatch.
- The in-flight grade-recovery work (backfill of recovered grades into Trade History and Performance) is unaffected and continues after this.
