# Publish, backfill broker evidence, then prove each trade end to end

Four things you asked for, in the order they can honestly be done. Each step depends on the previous one producing real broker data.

## What the database says right now

- `broker_trade_evidence` is **empty** — 0 rows. Nothing has been reconciled or recovered yet, so there are currently no "21 recovered trades" in P-Trades to show. They exist only in your broker's deal history until the recovery worker runs on the published site.
- Deliveries: 166 refused by P-Trades, 11 pending, 11 unknown, 1 settled expired but broker-confirmed closed.
- `live_execution_enabled` is **false**; `demo_auto_enabled` is true.

## Step 1 — Publish, then run the backfill

1. Publish the app so `/api/public/worker/recover-evidence` and the corrected reconciler exist in production (the hourly schedule is already installed).
2. Trigger one bounded recovery pass immediately instead of waiting for the top of the hour, with a 30-day window over your connected demo accounts.
3. Report the pass result: accounts read, deals matched, evidence rows written, and every failure verbatim (no silent "failed").

## Step 2 — Show the recovered filled-and-closed trades

From the evidence the pass actually wrote, a per-trade table: instrument, direction, volume, entry/exit price, entry/exit time, gross profit, commission, swap, currency, account.

On slippage, one honest limit up front: slippage is submitted price minus broker fill price, and the recovered trades are exactly the ones whose submitted rows retention deleted. So slippage is reported where a delivery row survived, and marked unavailable — never estimated — where it does not. If the broker's own history exposes the requested order price alongside the fill, that is used and labelled as broker-reported.

## Step 3 — Reconcile open positions and separate real trades from held capacity

1. Run the reconciler over the same accounts and persist each order's broker lifecycle (`resting`, `filled`, `open`, `closed`, `cancelled`).
2. Classify the 22 unsettled deliveries (11 pending + 11 unknown) against the broker:
   - **Real open trade** — the broker holds a position or a filled order.
   - **Real resting order** — the broker holds a live pending order not yet touched.
   - **Capacity hoarding** — no broker order or position exists, yet the row still occupies a daily/per-symbol slot.
3. Release only the hoarding rows, and only from broker-confirmed absence. Nothing is settled as "never filled" without closed broker history proving it.
4. Report the three groups with the broker order id behind each verdict.

## Step 4 — One demo market-entry order, traced end to end

This needs two switches you currently have off, so it is a deliberate, single-shot test:

1. Confirm the armed demo account and enable immediate market entry for it.
2. Enable broker submission for demo only (`live_execution_enabled` gates MetaApi submission; live/confirm/benchmark auto stay off, so no live-money path opens).
3. Wait for one qualifying signal with price inside the published maximum acceptable entry, and let the dispatcher submit exactly one market order.
4. Follow it through every layer and show you each artefact: the submitted order, the broker's `orderId` and return code, the broker deal(s), the resulting position, the evidence row, then the Trade History row and its contribution to Performance (R, expectancy population).
5. Restore the switches to their current state afterwards.

If you would rather not flip submission on today, steps 1-3 still run on their own and Step 4 waits.

## Technical notes

- Recovery entry point: `POST /api/public/worker/recover-evidence` (cron secret), engine `src/lib/evidence/recover.server.ts`, matching by `PT_` client id and magic.
- Reconciliation: `src/lib/evidence/reconcile.server.ts` over a 168-hour window, all reconcilable delivery states, persisting `broker_order_state`.
- Capacity release: `src/lib/delivery/direct-enqueue.server.ts`, broker-confirmed closure only.
- No number in any table comes from P-Trades' own guesses; every figure is broker-reported, and anything the broker does not report is shown as unavailable.
