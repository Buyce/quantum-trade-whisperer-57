# Why "safe to enter" setups are not being ordered

## Verified answer: the system is fail-closed on a stale broker contract specification

Nothing in the screenshots is a broker rejection, and the feed is not lying. The
"safe to enter — price inside the ceiling" badge is a *signal* statement (price
has not run past the published maximum acceptable entry). Whether an order can be
built is a separate, later check, and that check is failing before the broker is
ever contacted.

Confirmed from the live database:

- Every recent XAUUSD automatic order settled as **`account_spec_unavailable`**
  ("specification as of 2026-08-28T19:58:46"). 10 of the last 14 delivery rows
  refuse for exactly this. No submission timestamp, no broker order ID, no
  broker return code on any of them.
- The armed account's per-account contract specifications
  (`connected_account_specs`) were last fetched **2026-08-28 19:58 UTC** for
  XAUUSD, GBPAUD and EURUSD. Direct sizing rejects any account specification
  older than **36 hours**, so every automatic order has been refused since about
  2026-08-30 08:00 UTC.
- Root cause: those per-account rows are only ever written by `refreshSymbolMap`,
  which runs on account adoption and on a *manual* broker-account reconcile. No
  scheduled job refreshes them, while the benchmark table
  (`broker_symbol_specs`) does have a daily refresh cron. So the account
  specification inevitably ages out and then blocks orders permanently until
  someone presses refresh by hand.
- The same staleness is also shrinking the ceilings: decision rows read
  "2 of 1 automatic orders created today — adaptive limits reduced (broker data
  not fresh): 1/day".

So: safety logic is behaving exactly as designed; the *maintenance* of the input
it depends on is missing. That is the defect.

## Three further defects the same audit exposed

1. **Unresolved deliveries occupy capacity forever.** 160 refusals read
   "10 of 10 automatic orders unresolved right now". There are 11 rows in state
   `unknown` (all "account_refresh_unavailable: MetaApi 504 for account
   information") with **no broker order ID and no broker order state**. Capacity
   fails closed on a missing broker state, so these permanently consume slots
   even though the broker was never asked to place anything.
2. **Signal-card TIF says 30m while the real window is 3h.** The feed badge is a
   hardcoded `ORDER_TIF_MINUTES` constant, but the automatic-order window is the
   per-user `auto_order_window_minutes` (yours is 180). The card contradicts the
   engine.
3. **A stale specification is reported as an unrecoverable rejection.** The
   History copy says the broker "has not published a usable contract
   specification", which reads as a broker fault. The broker did publish one; it
   is our stored copy that went stale.

## What gets built

### 1. Keep per-account specifications fresh (removes the actual blocker)

- New bounded scheduled job that re-resolves symbols and re-fetches the contract
  specification for **armed** accounts only, well inside the 36-hour trust
  window (target: refresh anything older than 12 hours, capped requests per
  pass, skipped entirely when no account is armed).
- Reuses the existing `refreshSymbolMap` persistence — no new specification
  math, no copying benchmark or static values into an account row.
- If the broker cannot be reached, the stored row is left untouched and the
  order still refuses. No stored figure is ever treated as fresh.
- Additionally, when a direct order is refused purely because the specification
  aged out, the dispatch preflight attempts one bounded re-fetch for that
  account and symbol and proceeds only if the broker itself answers.

### 2. Release capacity from deliveries the broker never received

- An `unknown` delivery with no broker order ID and no client-ID match, once
  broker orders/positions/history have been read successfully, is resolved as
  broker-absent and stops counting against the concurrent ceiling.
- Anything unreadable, filled, partially filled or ambiguous keeps occupying its
  slot, exactly as now. Fail-closed behaviour is unchanged for genuine unknowns.
- The 11 currently stuck rows are resolved by that reconciliation pass, not by a
  manual edit.

### 3. Say what actually happened

- Signal cards show the owner's real automatic-order window instead of the fixed
  30-minute constant.
- History distinguishes "your broker's contract specification for this symbol is
  older than we will trade from — refreshing" from a genuine broker refusal, and
  names the specification age.
- Settings/Guide state plainly that automatic orders require a broker
  specification refreshed within 36 hours and that P-Trades now keeps it warm.

## Boundaries that do not move

- Real-money execution stays globally disabled; this affects demo automatic
  orders only.
- The 36-hour specification bound, equity freshness, quote freshness, spread,
  pending-limit geometry, margin and risk gates are all unchanged.
- No grading, scanning, sizing mathematics, R accounting or lifecycle change.
- No fabricated specifications, prices, fills or broker evidence. A refusal is
  never counted as a trade.

## Technical notes

- New `src/lib/accounts/refresh-armed-specs.server.ts` + public cron route
  `src/routes/api/public/cron/refresh-account-specs.ts`, scheduled via
  `pg_cron`/`pg_net` hourly, reusing `refreshSymbolMap` and the cron secret.
- `src/lib/delivery/revalidate.server.ts`: on `accountSpecStale`, one bounded
  broker specification re-fetch before refusing; distinct reason detail for
  "stale" vs "never stored".
- `src/lib/evidence/order-state.ts` / `reconcile.server.ts`: add the
  broker-absent resolution for reference-less `unknown` deliveries after a fully
  readable broker read; `direct-enqueue.server.ts` then excludes them from
  concurrency.
- `src/components/SignalCard.tsx`: window text sourced from the user's
  `auto_order_window_minutes` (falling back to the constant when unreadable).
- `src/lib/delivery/execution.ts` copy update; `docs/EXECUTION.md` and
  `docs/BROKER-ACCOUNTS.md` updated.
- New unit tests: spec-refresh selection and bounds, stale-spec re-fetch path,
  reference-less unknown resolution and capacity release, card window text. Full
  suite, lint, typecheck and build must pass.
