# Two open jobs: finish grade recovery, then cut refused-order waste

## Part A — Grade recovery: still valid, not finished

Checked the database just now: `broker_trade_evidence` has 22 rows, only **2** carry a grade, and
`signal_grade_source` / `signal_ref` are filled on **0** rows. So the plan you quoted is still
correct and still safe to execute — steps 1 and 2 are done, steps 3 to 5 are not.

Done already:
- Migration adding `signal_grade_source`, `signal_first_decision_at`, `signal_ref`, plus the
  one-time-fill relaxation of the immutability trigger.
- `src/lib/evidence/grade-recovery.ts` + `.server.ts` with tests (unique-match-only, ambiguity
  refused), wired into `recover.server.ts` and `reconcile.server.ts` so new orphans self-heal.

Remaining:
1. **Backfill the 20 orphan rows** through the same helper, writing the recovered signal into
   `signal_ref` (not `signal_id`, which is a foreign key to rows that no longer exist),
   `signal_grade_source = recovered_from_enqueue_decision`, and the first-decision timestamp.
2. **Surface it truthfully**: `src/lib/queries.ts` column list, `src/lib/history/broker-orders.ts`
   mapping, `AutomaticOrders.tsx` grade cell with a "recovered from decision log" marker.
   Detected time stays "unavailable" for these rows.
3. **Performance and learning**: grade mix, win rate by grade and per-grade net money include
   recovered grades, with the recovered population reported separately; export and
   `BROKER-EVIDENCE.md` updated.

No estimated values anywhere — plan-R, slippage and detection time stay unavailable for these rows.

## Part B — Reduce "Not sent — refused by P-Trades"

Refusals concentrate in a few reasons, and they are caused by **queue latency and blind retrying**,
not by bad signals. Verified counts and how long each order sat queued before being refused:

| Reason | Count | Avg time queued first |
|---|---|---|
| price ran beyond max acceptable entry | 75 | 104 min |
| broker/account spec unavailable | 51 | 91 min |
| automatic-order window expired | 26 | 224 min |
| market closed | 9 | 177 min |
| quote stale | 3 | 112 min |

Three defects behind those numbers:

1. **One order can monopolise the worker.** Delivery 11317 (XAUUSD, queued 03:35) has been
   re-asked **84 times** — `price_beyond_max_acceptable_entry` is retryable with **no backoff**,
   so the dispatcher retries it ~5 times a minute, spending a broker quote call each time.
2. **Head-of-line blocking.** The claim rule takes one most-urgent pending row per attempt, so
   while 11317 churned, delivery 11470 sat pending 90+ minutes with **0 attempts**; 16 rows are
   pending right now, the oldest from 03:35. Fresh setups age out waiting behind a stuck one.
3. **Refusals are found too late.** Market-closed, spec-unavailable and window-expired are all
   knowable at enqueue time, but are only checked at dispatch — after the row is created, counted
   against your limits, and shown to you as queued.

### Changes

1. **Backoff and give-up**
   - Add `next_attempt_at`; the claim RPC ignores rows scheduled for the future.
   - Escalating spacing on retryable refusals (1, 2, 5, 10, then 15 min) instead of every pass.
   - Terminalise early when price has moved beyond the entry ceiling by more than a configurable
     multiple of the setup's risk distance — that setup is not coming back.
   - Stop retrying once the remaining window is shorter than the next backoff step (replaces the
     flat 120-attempt ceiling).

2. **Fair claiming**
   - Claim a small batch per pass, round-robin across users and instruments, so a hot symbol
     cannot starve everything else.
   - Settle rows whose remaining window is under one dispatch cycle as expired instead of
     claiming them just to refuse them.

3. **Cheap checks move to enqueue**
   Refuse before a delivery row exists when the market is closed, when the sizing spec is missing
   and an on-demand refresh fails, or when the remaining window is below a useful floor. These
   stay full `execution_enqueue_decisions` rows with the same clear reason, so the audit trail is
   unchanged — you see why nothing was queued, without a phantom queued order.

4. **Make the cost visible**
   Admin panel: refusal reasons for 24 h / 7 d with attempts spent and average queue latency per
   reason; Trade History shows attempts spent on refused rows. A regression like 11317 becomes
   obvious within a cycle.

5. **Cleanup** — settle the current 16-row backlog under the new rules.

## Notes

- User-policy refusals stay exactly as they are (C-grade blocked 1451, session filtered 724,
  concurrent limit 346, duplicate resting order) — those are correct and intentional.
- No change to grading, sizing authority, or the live-execution lock; live execution stays
  globally disabled. Enqueue gates only ever reduce what is sent, and every downstream gate
  still re-checks at dispatch.
