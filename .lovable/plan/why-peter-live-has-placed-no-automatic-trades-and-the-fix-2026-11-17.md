# Why Peter Live has placed no automatic trades, and the fix

## What the records show (checked 17 Nov, 10:10 UTC)
- Peter Live is connected, a real account, trading allowed, set to Live auto, with no emergency stop. The platform live switches are on. The order system does pick it up as a live account.
- In the last 3 days **zero orders were created for Peter Live**. Every order created went to demo accounts.
- Your account's decision log shows only three reasons, the same every day:
  1. Just after midnight UTC, the first 2 or 3 setups (EURUSD) are refused because their expected result is below your 0.1R minimum.
  2. Those refused setups still count against your **daily setup allowance of 2**. From about 00:30 UTC, every later setup is refused as "daily cap reached" (126 setups on 16 Nov, 28 so far today).
  3. Setups that come back later are refused as too old (past the 15-minute order window).
- So the bot works. A setup that was never traded uses up your allowance, which blocks the rest of the day by 00:30 UTC.

## The fix
1. **Count only placed orders for automatic trading.** The daily setup allowance keeps limiting your Feed and alerts. Automatic orders stop counting it and use only your own order limits: 1 open at once, 2 per day, 1 per instrument per day. Those limits, the risk policy, the news, cohort and duplicate checks, the same-bet limit and the risk brakes all stay as they are.
2. **Clearer refusal message:** "daily cap reached" will say that the setup allowance was used up by setups, not by trades.
3. **Diagnostic fixes from your report:** the AI app's list of live accounts and live broker trades looks for the wrong account type, so it shows nothing. I'll correct that.
4. **Dry-run test of Peter Live:** run the existing Runtime Validation on Peter Live using a real current setup. It checks connection, prices, sizing and margin, then returns PASS or FAIL for each check. It never places an order.
5. **Reconciliation check:** Peter Live has never had a successful broker check. I'll find out why and fix it so its trades get settled once they exist.

## Not changed
No order is placed by me, and no account mode, key, risk limit or position changes. The first real trade starts with the next setup that passes every check, once this is published.

## Technical details
- `src/lib/delivery/direct-enqueue.server.ts`: stop applying `daily_setup_cap` to execution; keep `maximum_daily_signal_orders`, `maximum_concurrent_signal_orders` and `maximum_daily_orders_per_symbol`, all counted from `execution_deliveries`. Feed and alerts stay governed by `eligibility.ts`.
- `enqueue-log.ts`: reword `daily_cap_reached`.
- MCP `list_my_accounts` / `list_broker_trades`: map live to `broker_account_type='real'`.
- Tests: an [INVARIANT] test that a gate-refused setup does not use up the execution allowance, and one that the daily order ceiling still blocks the 3rd order. Run direct-enqueue and eligibility tests and the full suite.
- Runtime Validation: dry-run only, through the existing isolated module.
- Reconcile: read the worker logs for account `1abc8f49…`; `reconciliation_last_success_at` is null.
- Record the rule in AGENTS.md: the setup cap governs feed and alerts only; order ceilings govern execution.
