# Why the assistant says you have no trades — and the fix

## What I verified in your live data

Signed in as your owner account, your real broker record is:

- **108 closed, broker-confirmed trades** (26 Aug – 11 Sep), every one with a
  calculated R multiple, entry/exit price, volume, commission and swap.
- **139 order deliveries** to your broker.
- **0 rows in the trade journal.**

The assistant only ever looks at the **journal** — the table filled when a trade
is logged by hand in Trade History. Your trades came from automatic execution
and live in the **broker evidence** record instead. So the assistant read an
empty journal and answered honestly ("no trades"), while your actual 108 closed
broker trades sat one table away, untouched.

Same reason the 14-day performance answer came back empty: it counts journal
rows only.

This is a missing connection, not a data problem and not a made-up answer.

## The fix

### 1. Give the assistant your broker-confirmed trades

Add a broker-trades lookup it can call, returning your own closed and open
broker trades: instrument, direction, entry and exit price and time, volume,
commission, swap, R against plan and against actual risk, the setup grade it
came from, and whether the stop was broker-confirmed or inferred. Filterable by
instrument, by time window, and sortable so "what was my most profitable trade"
is answered directly — expressed in R multiples with the broker's own figures,
each keeping its provenance label.

### 2. Make performance answers count broker trades

Performance summary starts from broker-confirmed closed trades, with hand-logged
journal trades folded in and counted separately, so a window like "the past 14
days" reports both and says which source each number came from. It will also
state plainly when a number is broker-derived versus self-reported.

### 3. Teach the assistant the difference

Its standing instructions get the distinction: broker-confirmed trades are the
authority on what actually happened; the journal is your own notes and may be
empty even when you traded. An empty journal must never be reported as "you have
no trades" — it must check the broker record first.

### 4. Same for the MCP tools

The new lookup is registered as an MCP tool too, so an external AI client sees
exactly what the in-app assistant sees.

## Kept intact

- Nothing invented: every figure comes from the broker evidence rows already
  stored, with their existing provenance labels.
- Read-only: no orders placed, cancelled or changed.
- Your own account only. Cross-account answers stay aggregate-only — never
  another user's money, sizes or identity.

## Technical notes

- New `src/lib/mcp/tools/list-broker-trades.ts` with a shared
  `runListBrokerTrades` body over `broker_trade_evidence`, scoped by the
  existing `user_id = auth.uid()` SELECT policy (verified present). Inputs:
  `state`, `instrument`, `days`/`from`/`to` on `exit_at`, `order_by`
  (`exit_at` | `r_vs_actual_risk`), `limit`. Never selects another user's rows;
  no `user_id` in the projection.
- Registered in `src/lib/mcp/index.ts` (version bump) and exposed in
  `src/lib/assistant/tools.ts` as `list_broker_trades`.
- `runGetPerformanceSummary` extended to read `broker_trade_evidence` closed
  rows (window on `exit_at`) alongside `executed_trades`, returning both cohorts
  separately plus a combined R summary, keeping the existing window echo and the
  "dated by record time" fallback disclosure.
- Prompt rules added in `src/lib/assistant/system-prompt.ts` (broker evidence is
  the authority; empty journal is never "no trades").
- Tests: broker-trades tool behaviour (scoping, window, ordering, empty-result
  wording) and a performance-summary test covering broker + journal cohorts.
  Then typecheck, Vitest, build, and a live authenticated check asking both
  questions from the screenshot.
