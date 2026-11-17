# Fix: closed MT5 trades still showing "Open" in History

## How P-Trades learns a trade closed
Every 5 minutes a background check reads each connected account's broker history (deals, positions, orders) through MetaApi, matches the deals to P-Trades orders, and saves the result. History shows that saved result. It never reads the MT5 app directly.

## Why your gold trade still says Open
The matcher only accepts a deal if it carries the P-Trades order tag. The opening deal has it. When a trade is closed by stop, target or by hand in MT5, the closing deal often has no tag (or a different one), so it is thrown away. P-Trades then sees only the opening half: Open, entry commission -0.27, no exit, no profit. This matches your screen exactly. Confirmed in the current code.

## Changes
1. **Match closes by broker position number.** An untagged closing deal joins a P-Trades trade when it has the same broker position number and symbol as a proven P-Trades opening deal. Refused when the position also has someone else's opening deal, is a reversal, or is claimed by two P-Trades orders.
2. **Ask the broker directly for open trades that look stale.** For any P-Trades order still Open whose position no longer exists at the broker, fetch that position's deals by position number, so closes outside the normal time window are still found.
3. **Partial closes stay Open**; nothing is estimated. Exit, profit and costs come only from real broker deals.
4. **History refreshes itself** every minute while open, so a corrected result appears without reloading.
5. **Recover your gold trade (ticket 49064728)** by running one reconciliation pass after the fix, then confirm History shows exit, gross profit and both commissions from the broker. Your screenshot (exit 3860.77, net +3.69) is used only as a cross-check.

## Technical details
- `src/lib/evidence/associate.ts`: second pass in `groupOwnedDeals` for unmatched OUT/OUT_BY deals keyed on `positionId`+symbol, basis `position_id` (already allowed by DB constraint, no migration).
- `src/lib/metaapi/history.server.ts`: add read-deals-by-position call; `reconcile.server.ts`: use it for open evidence rows whose position is absent from current positions.
- `brokerOrdersQuery` in `src/lib/queries.ts`: `refetchInterval: 60_000`.
- Tests: untagged close, mismatched magic, close-by, partial close, foreign opening, two owners, out-of-window close.
- No order is placed, changed or closed. Needs publishing for the scheduled check to use it.
