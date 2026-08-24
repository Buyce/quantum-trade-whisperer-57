# Automatic trades in Trade History (and how they are valued)

## What is true today

- **Performance already values them.** Automatic orders that the broker actually filled and closed are read from broker evidence and shown on Performance under the scope "Your connected-account broker evidence" (`src/lib/performance-evidence.server.ts`, `src/routes/_authenticated/performance.tsx`). R comes from real broker fill and exit prices, so it is broker-derived, not self-reported.
- **Trade History does not show them.** That page reads only `executed_trades` — the setups you (or your assistant) logged by hand (`src/lib/queries.ts` `takenTradeHistoryQuery`). The evidence reconciler deliberately never writes to that journal, so an automatically submitted order appears nowhere on Trade History today.
- Both `execution_deliveries` and `broker_trade_evidence` already have owner-read access rules, so no new backend permissions are needed.

## What I will build

### 1. Trade History gets two tabs

- **Logged by me** — exactly today's list and behaviour (log outcome, edit prices, delete, exports) unchanged.
- **Automatic orders** — every order P-Trades submitted to your armed broker account, newest first, with:
  - instrument, direction, grade, and the setup's detection time
  - order state (queued, sent, acknowledged, rejected, failed, unknown) taken from the delivery row
  - broker outcome once the reconciler has matched it: entry price, exit price, volume, gross profit with currency, and R (R vs plan, plus R vs actual risk when the stop the broker actually held differs)
  - a plain "Open at the broker" state while the position is still open, and "Awaiting broker confirmation" when submitted but not yet matched — never a guessed outcome
  - DEMO / LIVE label from the broker-reported account type

No manual outcome entry on this tab: these rows are broker-derived, so entry/exit are never editable and nothing is ever estimated. Rows with no R yet show a blank R with the reason, matching the existing journal wording rules.

### 2. Exports include them

The CSV and JSON export buttons act on the visible tab, so automatic orders export with their broker fields and R basis labelled as broker-derived.

### 3. Copy that tells the truth

- Trade History intro states that the page holds both what you logged yourself and what P-Trades submitted automatically, and that the two are never mixed into one number.
- Performance gains a one-line pointer that automatic orders are valued under the connected-account broker-evidence scope, not under the self-reported journal.
- Empty states: "No automatic orders yet" only claims that this list is empty, not that the engine is idle.

## Explicitly not changing

- Automatic orders will **not** be written into `executed_trades`. Mixing broker-derived rows into the self-reported journal would corrupt journal statistics and the verification semantics.
- No change to scanner math, eligibility, sizing, order submission, or the reconciler.

## Technical notes

- New read module `src/lib/history/broker-orders.ts` (+ query in `src/lib/queries.ts`): joins the user's `execution_deliveries` rows to `broker_trade_evidence` by `delivery_id`, and to `scanned_signals` for instrument, grade, direction and detection time. Read with the browser client under the existing owner-read policies; identifiers stay out of the rendered DTO except the render key.
- `src/routes/_authenticated/history.tsx` gains a `Tabs` wrapper; the existing table becomes the first tab component with no behavioural change.
- R display reuses `src/lib/journal/display.ts` so the "blank means genuinely missing" rule is identical on both tabs.
- Tests: mapping tests for delivery-state → user-facing state, evidence-present vs absent (no invented outcome), open vs closed, and the missing-R case; taxonomy-tagged `[INVARIANT]`/`[UNIT]` as the suite requires. Docs updated in `docs/JOURNAL-AND-R.md` and `docs/EXECUTION.md`.
