# Restore honest broker-order accounting, then prove the fill repair

## What I verified in the live system before writing this

- `broker_trade_evidence` still holds **0 rows**, yet every connected account reports reconciliation **success** (latest success stamped 18:55 UTC today, no recorded error). The health signal is currently green while the evidence table is empty — exactly the false-success pattern the audit describes.
- Health aggregation is provably wrong: per-order failures are pushed as `"<brokerClientId>: ..."`, but the account is judged healthy by filtering errors that start with `"<accountId>:"`. The database write that records health also ignores its own error.
- Delivery states right now: 100 `rejected`, 11 `pending`, 8 `unknown`, 1 `claimed`, **1 `acknowledged`** (the only row still carrying a broker order id), 0 `expired`. Two counts taken minutes apart disagreed on the acknowledged total, and the 27 previously accepted orders are no longer present as acknowledged rows. This is consistent with the retention cascade defect: `purge_expired_signals` protects `pending`, `claimed`, `sent`, `unknown` but **not** `acknowledged`, and `execution_deliveries.signal_id` cascades on delete. The broker association is being destroyed before reconciliation can use it.
- Reconciliation writes only `broker_trade_evidence`; it never settles `execution_deliveries`, and capacity counts `acknowledged` as occupying — so a closed or cancelled order keeps holding a slot.
- Correction to the audit: `expire-orders` **is** scheduled in the database (`expire-unfilled-orders`, every 5 minutes, hitting `/api/public/cron/expire-orders`). What is missing is a migration in the repository recording that schedule — schedule drift, not an unscheduled sweeper.
- Correction on CI: the 11 lint errors are all formatting (prettier) in `reconcile.server.ts` and `performance.tsx`; the 24 warnings are pre-existing react-refresh notices.

## Repair order

### 1. Stop losing the broker association (highest priority)

- Change retention so a signal is never purged while a delivery of it still has unresolved broker activity: extend the protected states to include `acknowledged` and any row holding a `broker_order_id` without settled evidence.
- Remove the destructive dependency: keep an immutable delivery/broker snapshot (client id, broker order id, symbol, submitted geometry, timestamps) that survives signal deletion, instead of relying on the cascading `signal_id`.
- Migration only; no existing rows deleted or rewritten.

### 2. Make reconciliation health honest

- Aggregate per-account health from the errors actually produced for that account's groups (carry the account id alongside each error), not by string prefix.
- Propagate the health-write error into the pass result so a failed update cannot look green.
- Report explicitly: orders awaiting evidence, last successful pass, last failure and reason.

### 3. Reconcile broker order lifecycle, not just deals

Read pending orders, positions, history orders and deals for every account P-Trades submitted to, and resolve each associated order into exactly one broker-confirmed state: resting, filled/open, filled/closed, cancelled, expired, rejected, unresolved. Persist that state on the delivery, keeping evidence rows the authority on R.

### 4. Release capacity from real broker state

Derive the concurrent-order count from the reconciled broker state: open positions and genuinely resting orders occupy slots; closed, cancelled, expired and broker-absent orders release them immediately. No time-based seven-day assumption.

### 5. Backfill and containment before more submissions

- Cap demo automatic submission at one concurrent order until the historical order ids are reconciled.
- Live-money execution stays disabled throughout.
- Run a bounded backfill over broker history for the surviving associated order ids and record what the broker actually says about each.
- Cancel only orders the broker confirms as stale resting beyond the owner's configured window.

### 6. Truthful UI wording

Anything not confirmed against current broker state reads **"awaiting broker evidence"**. "Resting at broker" appears only when the latest reconciliation saw the order resting. History and exports keep submitted, resting, open, closed, expired, broker-rejected, P-Trades-refused and unknown as separate counts, and label market entry versus pending limit.

### 7. Tests and CI gate

- Database-backed integration coverage: entry-only open position, later closure, cancellation, broker-absent order, malformed mixed deal group, retention with an unresolved acknowledged delivery, and capacity release on close.
- End-to-end open → closed reconciliation regression test (still missing today).
- Fix the 11 formatting errors and require a green CI run before deployment.

### 8. Market-entry canary (last)

One bounded demo canary with immediate market entry, then compare fill rate, slippage in R and expectancy against pending limits. Ten remains a ceiling, never a quota: no forced volume, no widened entry ceilings, no price chasing.

## Safety boundaries

No changes to signal detection, grading, alert eligibility, lifecycle promotion, replay, shadow or research models. No fabricated fills, prices or evidence. No increase to risk percentage, order ceilings or approved instruments. No live-account execution. No deletion of audit history.

## Technical notes

- `supabase/migrations/*`: retention predicate change plus an immutable delivery snapshot table; a migration that records the existing `expire-unfilled-orders` schedule so the repo matches the database.
- `src/lib/evidence/reconcile.server.ts`: account-scoped error accumulation, propagated health write, order-state resolution from `fetchOrders` / `fetchPositions` / `fetchHistoryOrders` / `fetchDeals`.
- `src/lib/delivery/direct-enqueue.server.ts`: capacity from reconciled broker state instead of `OCCUPYING_STATES` by age.
- `src/lib/delivery/expire-unfilled.server.ts`: settle broker-absent and broker-closed orders instead of only confirmed cancellations.
- `src/lib/history/broker-orders.ts`, `src/components/history/AutomaticOrders.tsx`, `src/lib/export.ts`, `src/routes/_authenticated/performance.tsx`: wording and reconciliation-health surfacing.
