# Split admin metrics by author: human vs AI agent

Today only *prices* carry provenance (`price_source` human/agent on `executed_trades`). Verified against live rows: all 25 logged decisions have `price_source = null`, and `agent_registrations` has 0 rows — so nothing else in the admin terminal can currently tell a human apart from an assistant. Accounts, taken/skipped and the user-reported win rate are all author-blind by construction.

This adds provenance at the two remaining write points (account creation, decision logging) and then splits four admin sections by author.

## 1. Record who is acting

**Account origin** — new columns on `public.profiles`: `signup_source` (`human` | `agent`, default `human`) and `signup_client` (assistant label, null for humans). The agent registration endpoint already accepts a `client` field; it will pass it through sign-up metadata, and `handle_new_user()` copies it onto the profile. Existing accounts backfill as `human` (they were all created in the browser).

**Decision origin** — new columns on `public.executed_trades`: `decision_source` (`human` | `agent`) and `decision_source_client`. Stamped server-side, exactly like prices:
- web terminal writes (`recordTradeDecision` / `recordTradeOutcome`) → `human`
- the `log_trade_decision` and `update_trade_outcome` MCP tools → `agent` + the assistant's OAuth client id

Never accepted as input, so an agent cannot claim to be human. The 25 existing decisions backfill as `human`.

## 2. What you will see in the Admin Terminal

- **Active accounts** tile: sub-line becomes `N human · N agent`, with the agent clients listed on hover.
- **Taken / skipped** tile: sub-line becomes `human N/N · agent N/N`.
- **User-reported win rate** tile: sub-line gains the split — win rate and sample size for human-logged vs agent-logged outcomes, so a drifting assistant shows up as a diverging win rate.
- **User-reported data integrity** panel: the verdict counters (verified / unverifiable / contradicted / trust score) get a per-author row, and the existing per-row table shows the decision author next to the price author. The `agent_entered_price` flag stays as it is.

Empty states stay honest: with zero agent activity every agent column reads `0`, never a placeholder.

## 3. Learning engine

Unchanged. Only deterministic shadow replay trains the Bayesian model; no user-reported or agent-reported number enters it.

## Technical notes

- **Migration**: add the four columns (with CHECK constraints on the two source columns), backfill both to `'human'`, update `public.handle_new_user()` to read `signup_source` / `signup_client` from `raw_user_meta_data`, and extend `public.get_admin_intelligence()` — `engagement.active_accounts_by_source`, `engagement.decisions_by_source`, and `engagement.user_reported_by_source`. Admin guard (`is_admin()`), `STABLE SECURITY DEFINER` and the 3s statement timeout stay exactly as they are. No new grants needed (existing tables, existing policies).
- `src/routes/api/public/agent/register.ts`: pass `options.data = { signup_source: 'agent', signup_client }`.
- `src/lib/trade-journal.functions.ts`, `src/lib/mcp/tools/log-trade-decision.ts`, `src/lib/mcp/tools/update-trade-outcome.ts`: stamp the decision source.
- `src/lib/admin.functions.ts`: extend the `AdminEngagement` type.
- `src/lib/user-audit.functions.ts`: select the new columns, add `decisionSource` per row and per-author verdict totals.
- `src/routes/_authenticated/admin/intelligence.tsx` + `src/components/admin/AdminPanels.tsx`: render the splits.
- `src/lib/db-types.ts`, `src/lib/queries.ts`: new columns on the trade row type.
- No change to grading, the scanner pipeline, alerts, or any user-facing page other than the new hidden fields.
