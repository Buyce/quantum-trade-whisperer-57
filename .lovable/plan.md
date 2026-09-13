# Assistant everywhere: fix performance answers, strategy knowledge, chat widget

## Bug fix first: performance questions fail

The screenshot shows the assistant answering "I was unable to retrieve your
performance summary." Root cause is confirmed in code: `get_performance_summary`
has no time input (only an R-basis option), so a question like "how has my
performance been for the past 2 weeks" gives the model no way to filter by
date and the tool call fails. Fix: add an explicit date window — a number of
days, or a from/to pair, applied to the trade closure time (`actual_exit_at`,
UTC) — in the shared body used by both the MCP tool and the assistant, so both
surfaces accept the same question and report the window they used. Time-window
questions then return real numbers instead of an apology.

## Where things already stand

The assistant is live and already reads real P-Trades data through the same shared
bodies the MCP tools use, under the signed-in user's own permissions: setups,
scanner and market status, automatic-order decisions, risk holds, settings,
sizing, replay intelligence, shadow comparison, trades and performance. Live
worldwide research runs on your Google key with sources and dates.

Two things are missing for what you asked:

1. It has no grounded knowledge of **how P-Trades strategies work** — grading,
   eligibility, R-maths, brakes, gates, lifecycle. Today it can only describe
   numbers, not explain the method, so those answers would be improvised.
2. It only exists on its own page. There is no way to ask a question while
   looking at the feed.

## What gets built

### 1. Strategy knowledge the assistant can quote

Add a read-only knowledge tool that serves the project's own written
documentation (grading, eligibility and caps, risk sizing, R and journal
maths, brakes and gates, execution semantics, instrument lifecycle, market
context, research and shadow replay, glossary). The assistant searches and
quotes those documents by name instead of inventing an explanation, so
"how does your A+ grade work?" or "what does resting mean?" is answered from
the actual specification. Nothing new is written or generated — it is the same
documentation the team maintains.

### 2. Chat widget on Home and the Signal Feed

- Extract the existing conversation into one shared chat panel so the widget and
  the full Assistant page always behave identically (same streaming, same tools,
  same settings-approval prompt).
- Add a floating "Ask" button, bottom-right, that opens the chat in a panel over
  the current page — a sheet on phones, a docked panel on desktop.
- Mount it on the signed-in landing page and on the Signal Feed. It keeps one
  conversation so context carries across pages, with a link to open the full
  Assistant page.
- When a setup is on screen, opening the widget from a setup card seeds the
  question with that setup so the assistant can pull its real record.
- The public marketing home stays as it is; the widget requires a signed-in
  session, so visitors there get a link to sign in instead.

### 3. Live feed awareness and honest web use

- The assistant is told, in its standing instructions, to check scanner and
  market status before any statement about what the engine is doing, and to
  keep the rule that a filtered empty result is never a "No Trade" claim.
- Web search stays on: it can read worldwide news and any strategy material on
  the public web, but everything from the web is labelled outside information
  with source and date, never mixed into P-Trades numbers and never presented
  as if P-Trades itself adopted it. The terminal's grading, sizing and brakes
  are engineering rules — the assistant explains them, it does not improvise
  new ones from web content.

### 4. Platform-wide knowledge, with money kept private

The assistant gets access to the whole platform's learning and performance
record, not just the asking user's own rows, so it can compare and analyse
properly:

- **Platform-wide, for everyone:** engine and learning evidence — scanner
  health, published setups, grade and instrument outcome rates, replay and
  shadow results, research-candidate funnel, execution quality, fill rates,
  expected-R by cohort, instrument lifecycle stages. This is the material that
  answers "does this setup type actually work" and "how do my results compare
  to the platform".
- **Aggregated only, never itemised:** any platform-wide figure is returned as
  totals and rates across accounts, with a minimum group size so a single
  account cannot be singled out.
- **Never disclosed to another user:** account equity, balance, profit or loss
  in money, deposits, position sizes in lots or currency, broker account names
  or numbers, emails, user ids, individual trades or orders belonging to
  someone else. Comparisons are expressed in R-multiples and percentages —
  never another person's money.
- **Own account, in full:** each user keeps complete detail of their own
  setups, orders, trades, settings, holds and equity, exactly as today.
- **Owner:** the owner keeps the existing platform-wide detail available in
  Admin Intelligence, unchanged.

This is enforced in the database, not just in the prompt: platform-wide reads
go through dedicated aggregate-only functions that never return per-user money
columns or identifiers, so no wording in a conversation can talk the assistant
into leaking another account.

## Rules kept intact

- No fabricated prices, fills, counts or rates; every number keeps the
  provenance label its source gave it.
- Read-only against the broker: no placing, cancelling or changing orders.
- Only the signed-in user's own data, under existing access rules.
- Settings changes still need explicit confirmation, and risk-money changes
  still need the extra confirmation step with warnings repeated verbatim.

## Technical notes

- Date window in `src/lib/mcp/tools/get-performance-summary.ts`
  (`runGetPerformanceSummary` + MCP/assistant schemas): optional `days` or
  `from`/`to`, filtered on `actual_exit_at` in UTC; the result echoes the
  window applied. Shared body, so MCP and assistant stay identical.
- New `src/lib/assistant/knowledge.ts` embedding curated excerpts from `docs/*`
  at build time (no filesystem reads at runtime — the server runs on the edge),
  exposed as a `search_platform_docs` tool in `src/lib/assistant/tools.ts`.
- New `src/components/assistant/AssistantPanel.tsx` (shared transcript +
  composer, extracted from `assistant.$threadId.tsx`) and
  `AssistantWidget.tsx` (floating trigger + `Sheet`), reusing the installed AI
  Elements primitives. `assistant.$threadId.tsx` re-renders the same panel.
- Widget resolves or creates a thread via the existing
  `threads.functions.ts` server functions and remembers the active thread id per
  browser, keyed so messages cannot bleed between threads.
- Mounted in `src/routes/_authenticated/feed.tsx` and the signed-in landing
  route; not in `AppShell`, so it stays off Settings/Admin screens.
- Prompt additions in `src/lib/assistant/system-prompt.ts`.
- Tests: knowledge-tool retrieval, widget thread resolution, and a docs-contract
  check that the referenced documents exist. Then typecheck, Vitest, build.
