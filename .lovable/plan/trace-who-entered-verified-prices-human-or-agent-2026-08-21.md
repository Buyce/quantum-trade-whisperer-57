# Trace who entered verified prices: human or agent

Right now a verified trade looks identical whether a person typed the fill prices in the terminal or an AI assistant wrote them over the MCP connection. This adds permanent provenance to every price write so a bad number can always be traced back to its author.

## What gets recorded

Each time an outcome with prices is saved, the trade stores:

- **Who wrote it** — `human` (the web terminal) or `agent` (an AI assistant over MCP).
- **Which agent** — the OAuth client id of the connected assistant (e.g. the ChatGPT/Claude connector), so two different assistants on the same account are distinguishable.
- **When** — the timestamp of the price write.

Provenance is stamped server-side from the actual request path. It is never accepted as an input, so an agent cannot claim to be a human.

## What you will see

- **Trade history**: the existing "Verified" badge gains its author — "Verified · you" or "Verified · agent". Hovering shows which assistant and when.
- **Admin data integrity panel**: a new breakdown of verified trades by author (human vs each agent client), plus a new audit flag `agent_entered_price` on rows an assistant priced. The existing integrity flags (never filled in replay, R exceeds structural max, preset R values) keep working and now report their author, so a cluster of hallucinated prices from one assistant is visible at a glance.
- **Learning engine**: unchanged. User-reported prices, human or agent, still stay out of the Bayesian model — only deterministic shadow replay trains it.

## History that already exists

Existing verified trades were all entered by hand in the terminal, before agents could write prices at all, so they are backfilled as `human`. Trades with no prices stay unattributed until someone verifies them.

## Technical detail

**Migration on `public.executed_trades`**
- `price_source text` — null when unverified; `'human'` or `'agent'`, enforced by a CHECK.
- `price_source_client text` — MCP OAuth client id, null for human writes.
- `price_recorded_at timestamptz`.
- Backfill: rows with `actual_entry_price is not null` become `'human'` with `price_recorded_at = updated_at`.
- No new grants or policies needed — the columns live on an existing table already scoped by `trades_manage_own`.

**Write paths**
- `src/lib/trade-journal.functions.ts` (`recordTradeOutcome`) stamps `price_source: 'human'`, client null.
- `src/lib/mcp/tools/update-trade-outcome.ts` stamps `price_source: 'agent'` and `price_source_client: ctx.getClientId()`.
- Both clear all three fields when the outcome is set back to `open` or prices are dropped, so provenance never outlives the prices it describes.

**Read paths**
- `src/lib/queries.ts` selects the new columns; `src/routes/_authenticated/history.tsx` renders the author on the verified badge.
- `src/lib/user-audit.functions.ts` adds the `agent_entered_price` flag and per-author counts; `src/components/admin/AdminPanels.tsx` and the admin route render the breakdown.
- `src/lib/mcp/tools/list-my-trades.ts` returns the author so an assistant can see what it wrote versus what you did.
- `src/routes/connect.tsx` notes that agent-written prices are labelled as such.
