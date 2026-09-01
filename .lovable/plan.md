# Found the data trail: the losses are real P-Trades trades that the app lost track of

## What the broker's own records show

Demo account ending 9863 (the one that started at 100,000 and now shows 97,900.30):

- 43 broker deals since 24 Aug. 42 of them carry P-Trades' own magic number
  (950009563) and P-Trades' own `PT_…` client ids — they were placed by the
  automatic bot, not by hand.
- They form **21 completed round trips** between 26 Aug 19:30 and 28 Aug 02:12
  on XAUUSD, EURUSD and GBPAUD: **10 winners, 11 losers**.
- Sum of broker-reported profit: **+3,908.42 / −5,923.55 = −2,015.13**, and with
  swap and commission that is exactly the ~2,100 drop in balance.

So the statement "no automatic trade was ever filled" is wrong: they filled,
they closed, and they lost money. What is true is that **P-Trades has no record
of them**, which is why History and Performance show zero fills.

Second account ending 9617 is a different story: all of its deals carry magic 0
and no client id, so they are **not** P-Trades orders. Its ~9k floating loss
belongs to trades placed outside the bot.

## Why P-Trades lost the trades

Confirmed from the database:

- `broker_trade_evidence` — 0 rows.
- `broker_order_associations` — 4 rows only, all from 28 Aug.
- `execution_deliveries` — only 4 rows still carry a `client_id`, and the lowest
  surviving id is 4134. Every delivery behind those 21 filled trades
  (client ids …_1321 through …_3848 and …_5010 through …_6898) **no longer
  exists**: the signal-retention purge deleted the signal rows and cascaded the
  deliveries away, because at purge time those deliveries had no
  `broker_order_id` recorded and were not in a protected state.
- The one surviving filled trade, delivery 6356 (GBPAUD, closed +288.28 at the
  broker), is stored as `state = expired` — labelled as never filled.
- Reconciliation only looks at deliveries in `sent`/`acknowledged`/`unknown`
  within a 72-hour window, so even surviving rows in `rejected`/`expired` can
  never be matched to broker deals.
- The account also recorded `evidence write failed` for 6356 with no reason
  captured, so the single matchable trade still produced no evidence row.
- Separately: the general MetaApi token is refused (403) on both accounts; only
  the provisioning token has access. Every broker read wastes a rejected call
  first and any code path without the fallback fails outright.

## Repair plan

1. **Stop deleting the evidence trail.** Change retention so a signal is never
   purged while any delivery for it was submitted to a broker (has a client id
   or a submitted timestamp), regardless of its current state. Add a
   backfill that writes an association row at submission time, not at
   reconciliation time.
2. **Reconcile by broker client id, not by delivery state.** Widen the
   reconciler's delivery scope to every delivery that was ever submitted
   (including `expired`, `rejected`, `failed`), and extend the lookback to cover
   the full retention window rather than a fixed 72 hours.
3. **Recover the 21 lost trades.** One-off backfill that reads the broker's own
   deal history for account 9863, groups P-Trades-owned deals by client id, and
   writes `broker_trade_evidence` plus `broker_order_associations` rows straight
   from broker figures. Deliveries that were deleted are reconstructed as
   evidence-only records marked "delivery record lost to retention" — no
   invented geometry, no invented prices.
4. **Fix the false "expired" label.** A delivery with broker-confirmed fills is
   `closed_at_broker`, never `expired`; the sweeper must not settle a delivery as
   expired without confirming the broker never filled it.
5. **Surface evidence-write failures.** Carry the database error message into
   the reconciliation health error instead of the opaque
   `evidence write failed`.
6. **Fix the credentials order.** Detect that the general token has no access to
   customer accounts and prefer the token that does, so broker reads stop
   spending a 403 on every call.
7. **Correct the UI story.** History and Performance must show these 21
   broker-confirmed round trips as filled and closed with broker-reported profit,
   and must stop implying that nothing ever filled.

## Technical notes

- Files: `src/lib/evidence/reconcile.server.ts` (scope + error detail),
  `src/lib/delivery/expire-unfilled.server.ts` (expiry vs broker fill),
  `src/lib/history/broker-orders.ts` (labels), `src/lib/metaapi/config.server.ts`
  (token order), plus a migration changing `purge_expired_signals` protection
  and a bounded backfill route under `src/routes/api/public/worker/`.
- Every recovered number comes from MetaApi deals (price, volume, profit,
  currency, timestamps). Nothing is estimated or synthesised.
- Live-money execution stays disabled throughout.
