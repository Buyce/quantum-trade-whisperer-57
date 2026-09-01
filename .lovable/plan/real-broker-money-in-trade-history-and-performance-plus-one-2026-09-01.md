# Real broker money in Trade History and Performance, plus one traced demo order

## What the data already says (checked just now)

- Broker evidence holds **21 closed trades** — 20 recovered from broker history, 1 still linked to its order row. Their broker figures sum to **gross -2,015.13** and **swap -84.57**, which is exactly your MetaTrader footer (`-2 015.13`, profit `-2 099.70`, balance `97,900.30`). So nothing is missing from the backfill: your funded history starts 24 Aug and the earliest broker deal is 26 Aug 22:30, all inside the window already scanned. There is no earlier filled trade to recover.
- Why the screens look poorer than MetaTrader: **20 of 21 rows have no order row left** (retention deleted it), so submitted volume/entry/stop/target are genuinely gone, and `r_vs_plan` exists for only 1 row. Performance today reads **only `r_vs_plan` / `r_vs_actual_risk`** — it never reads `entry_price`, `exit_price`, `gross_profit`, `commission` or `swap`, which is why real P/L is invisible.
- Deliveries: 167 rejected by P-Trades, 13 pending, 12 expired, 1 acknowledged.
- `live_execution_enabled` is **false**, `demo_auto_enabled` is true, live/confirm/benchmark auto all off.

## 1. Performance on broker money, not invented plan prices

- Load the broker money columns (`volume`, `entry_price`, `exit_price`, `gross_profit`, `commission`, `swap`, `profit_currency`) into the Performance evidence DTO, still identifier-free.
- Show, per currency, realised **net P/L** (gross + swap + commission) alongside the existing R statistics, with the trade count behind it.
- R basis rules stay honest: expectancy uses **R vs actual risk** for rows with no surviving plan (that is 20 of 21), and plan-R keeps its own population. No plan price is ever invented for a recovered row — those cells stay "unavailable".
- Mixed-currency populations are reported per currency, never summed across currencies.

## 2. A real broker slippage field

- Add `published_entry`, `slippage_price` and `slippage_availability` to broker evidence via migration.
- Fill it only from facts: published entry (from the surviving delivery row) minus the broker's fill price, signed so positive means worse than published. Where no delivery row survives, availability is `unavailable_no_submitted_record` and the value stays NULL — never estimated.
- Reconciler and recovery worker both write it; a one-off backfill sets availability for the existing 21 rows (the 1 linked row gets a real number).
- Trade History shows it as "Slippage vs published entry" with the unavailable reason spelled out.

## 3. Trade History filter section

A filter bar above the automatic-orders list, applied client-side to the loaded page set:

- **Instrument** (multi-select from the rows present)
- **Grade** (A+, A, B, C, Unknown)
- **Result**: winners / losers / breakeven / open / not filled
- **Profit**: minimum and maximum net money
- Plus a MetaTrader-style compact table view of the filtered rows: time in, symbol, direction, volume, fill, exit, time out, gross, swap, commission, net, slippage, R — every column broker-reported or blank.
- Filter state resets cleanly, shows the matched count, and CSV/JSON export honours the active filter.

## 4. One demo market-entry order, traced end to end

Requires two switches you have off, so it is deliberate and single-shot:

1. Confirm the armed demo account, enable immediate market entry for it.
2. Turn `live_execution_enabled` on with demo submission only (live/confirm/benchmark auto stay off, so no live-money path opens).
3. Wait for one qualifying signal with price inside the published maximum acceptable entry; the dispatcher submits exactly one market order.
4. Show every artefact in order: submitted order and payload, broker `orderId` and return code, broker deal(s), resulting position, evidence row, then its Trade History row and its contribution to Performance (net P/L, R, expectancy population).
5. Restore both switches afterwards.

## Is the auto trader still able to do this today?

Yes — and the path is better than it was on 26-28 Aug, with one gate that is deliberately still closed:

- Then: orders went to the broker, filled and closed, but retention deleted the order rows before reconciliation, so P-Trades lost them. Fixed — purge now protects signals with deliveries, reconciliation runs a 168-hour window over all reconcilable states, and the recovery worker rebuilds evidence from broker history hourly.
- Then vs now: spec staleness, margin estimation, duplicate resting orders, and the capacity-hoarding sweeper were all repaired since, and broker lifecycle (`resting`/`filled`/`open`/`closed`/`cancelled`) is now persisted per order.
- The one difference that stops trades today is `live_execution_enabled = false`: submissions are dry runs. Step 4 flips it for demo only. With it on, users do not need to open MetaTrader — the reconciler and recovery worker bring fill, close, money and R back into Trade History and Performance by themselves.

## Technical notes

- Performance: `src/lib/performance-evidence.ts` DTO + `performance-evidence.server.ts` select, `src/lib/performance.ts` aggregation, `src/routes/_authenticated/performance.tsx`.
- Slippage: migration on `broker_trade_evidence`, writers `src/lib/evidence/reconcile.server.ts` and `src/lib/evidence/recover.server.ts`, backfill through `run_sql`.
- Trade History: `src/components/history/AutomaticOrders.tsx`, view mappers in `src/lib/history/broker-orders.ts`, export in `src/lib/export.ts`.
- Step 4: `src/lib/accounts/arm.server.ts`, `src/lib/delivery/revalidate.server.ts`, dispatcher worker `/api/public/worker/dispatch`.
- No seeded, mocked or estimated financial value anywhere; unavailable stays unavailable.
