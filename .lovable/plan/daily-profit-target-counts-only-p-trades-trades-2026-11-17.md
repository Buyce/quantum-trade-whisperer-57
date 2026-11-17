# Daily profit target counts only P-Trades trades

## What changes
- The account's "daily profit objective" (stop-after-profit, $200 on Peter Live) will only count profit from trades that P-Trades placed on that account today. Profit from your own manual trades will no longer stop the auto-trader.
- The daily loss limit and total drawdown limits stay account-wide. They still count manual trades, because a broker or prop firm limit applies to the whole account no matter who placed the trade. Manual losses still pause auto-trading. Manual profits do not.
- Deposits and broker credits stay excluded, as they are now.
- The dry-run test and the Accounts page show "P-Trades profit today" separately from "account profit today", so it's clear which number the target uses.

## Result for Peter Live today
The +$372 came from manual trades, so P-Trades' own profit today is $0. That's under the $200 target, so auto-trading can place trades again, subject to all the usual checks. After the change I'll run the no-order dry-run test again to confirm the profit check passes and that the price, sizing and margin checks are reached.

## Technical details
- `src/lib/accounts/policy.server.ts`: from today's broker deals, compute two totals:
  - `todayNetPnl`: every trading deal, used for the daily loss limit (unchanged).
  - `todayPTradesNetPnl`: only deals P-Trades placed. These are recognised the same way broker reconciliation does it, through `groupOwnedDeals` / `parseClientId` (P-Trades clientId, plus the account magic number when the broker reports one).
- `src/lib/accounts/policy.ts`: the profit-objective check and "profit remaining" use `todayPTradesNetPnl`. If that total can't be read, the check fails closed as it does today.
- Update the validation report fields and the assistant/MCP policy text so they say the target counts P-Trades trades only.
- Tests: manual profit ≥ target does not block; P-Trades profit ≥ target blocks; manual loss still counts toward the daily loss limit.
