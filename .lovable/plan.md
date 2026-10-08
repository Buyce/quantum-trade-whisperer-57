# Why accepted trades are stuck on "Awaiting evidence", and the fix

## What the live data shows

The five cards in your screenshot (EURUSD 28 Sept, XAUUSD + GBPAUD 29 Sept, XAUUSD + EURUSD 30 Sept) are all on demo account ending 9863. The broker accepted all five (TRADE_RETCODE_DONE, broker order ids recorded), but P-Trades has saved **no result for any of them** and has never recorded a broker state for them.

The **last closed trade P-Trades saved on any account was 25 Sept 04:45 UTC**. The broker check last succeeded on 25 Sept 06:00 and has silently done nothing useful since. Three separate faults stack on top of each other:

1. **Results are rejected when saved (started 25 Sept).** The code now labels where a trade's stop loss came from using new names ("broker position", "broker reported none", "unknown"). The database still only accepts the old names, because the database update written on 26 Sept to allow the new names was never applied. So every closed trade the checker found was refused at save time. One account even recorded that exact refusal message.
2. **The checker only looks back 7 days.** These orders are now 8 to 10 days old, so the check has stopped looking at them. Every 5 minutes today it reports "0 accounts checked". Even after fault 1 is fixed, these trades would stay stuck forever.
3. **The broker connection has been failing since 4 Oct.** From 4 to 7 Oct, MetaApi answered almost every account read with a timeout error (504): zero successful account reads over those four days, plus some "no permission" errors (403). A recovery attempt at 09:41 today failed on all four accounts with the same timeouts. The trades can't be recovered until the broker can be read again.

On top of this, the History card keeps saying "Awaiting evidence" when the true message is "P-Trades can't currently check this with your broker." That made the problem invisible.

Your trades are not lost. The broker still has the full deal history, and P-Trades can read it back once these faults are fixed.

## Fix, in order

1. **Apply the missing database update** so the new stop-loss labels are accepted. The existing update file is applied exactly as written. Nothing is deleted. Only two old label values are renamed, as the file already specifies.
2. **Stop abandoning old orders.** Every order the broker accepted that still has no saved result stays in the check until it is settled, however old it is, up to the retention window. The broker history read starts from the oldest unsettled order, not a fixed 7 days ago.
3. **Get broker reads working again.** Check each account's connection state at MetaApi. If an account has been switched off ("undeployed") there, switch it back on through the existing account-refresh path. Then put the access key that actually has permission first, so reads stop getting a "no permission" refusal before they succeed. Before changing anything, confirm whether the timeouts come from the account state or from MetaApi itself.
4. **Make the broker check honest.** Every check, even one that stops partway, records its result and the reason it failed. History cards and the account control center show "Broker check failing since {date}: {reason}" instead of "Awaiting evidence" when the last successful check is older than the order.
5. **Recover the stuck trades.** Once broker reads work, run a one-off bounded check for account 9863 (and the still-open order on account ending c853). It saves each trade's fill, exit, profit, swap, commission and R using only figures from the broker's own deals. Nothing is estimated. Then confirm the five cards show Win or Loss with the broker's numbers.
6. **Tests:** the new stop-loss labels save successfully. An accepted order older than 7 days with no saved result is still checked. A failing broker check shows as failing, not as "awaiting evidence".

## Not confirmed yet

From 25 Sept to 3 Oct the broker was mostly reachable, yet no check recorded a success or an error. Fault 1 explains why nothing was saved, but not why the health stamp also stopped updating. Step 4 includes finding this by running one real check and watching where it stops. Possible causes: the check is cut off by the 30-second limit, or it fails at the new "Needs review" mismatch step, which has never saved a single row.

## Technical notes

- Constraint today: `stop_source IN ('broker_order','planned_submitted','unavailable')`. Writers in `src/lib/evidence/reconcile.server.ts:681` and `recover.server.ts:243` emit the newer set from `supabase/migrations/20260926000000_align_broker_evidence_stop_source.sql`.
- `RECONCILE_WINDOW_HOURS = 168` with `.gte("submitted_at", since)`. Add a second query: `acknowledged`/`sent`/`unknown` deliveries with a `client_id` and no evidence row, ordered oldest first and capped. Use the oldest of those to set `historyStart` (deals paging is already bounded at 10 pages).
- `metaapi_api_observations` (surface `client`): from 4 to 7 Oct, `ok` = 0 per day; about 8,300 `account information` 504s and about 700 `history deals` 504s in the last 3 days.
- Health write: wrap the per-account loop so a thrown error or a timeout still calls `recordReconciliationHealth`. Expose `reconciliation_last_success_at` to `src/lib/history/broker-orders.ts` for the stale label.
- Live-money execution, sizing, grading and signal logic are untouched.
