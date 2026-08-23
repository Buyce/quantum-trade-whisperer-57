# Multiple accounts, and how demo vs live data is labelled

## Answers (verified against the database and code)

**Can a user connect a live and a demo account at the same time? Yes — one of each by default.**
The quota is a real, SQL-enforced limit: `account_quota_defaults` is currently
`max_demo = 1`, `max_live = 1`, so one demo plus one live connection can be
active simultaneously. Per-user overrides exist (`account_quota_overrides`) so a
specific user can be raised above that without a code change. The limit counts
only connections that are not disconnected, and it is enforced by a database
trigger, so no code path can exceed it.

**Is demo and live data labelled differently? Partly — and there is one real gap.**

Labelled correctly today:
- Each connection stores the broker's own verdict (`broker_account_type`:
  demo/real/contest/unknown), separately from the user's onboarding intent, and
  the /accounts screen shows both.
- Every execution attempt records `connected_account_id`, `account_mode`
  (observe / demo_auto / live_confirm / live_auto) and `dry_run`.
- Broker evidence rows carry `account_id`, `metaapi_account_id` and
  `broker_account_type`, so a filled order is always attributable to the exact
  account and its type.

The gap:
- `executed_trades` — the journal table behind Trade History and the Performance
  dashboard — has **no account link at all** (no `connected_account_id`, no
  account-type column). So once a result reaches performance statistics, a demo
  result and a live/manual result are pooled into the same expectancy, win rate
  and R distribution, with no way to filter or even tell them apart.

## Proposed fix (small, no scanner/statistics math changes)

1. Add nullable `connected_account_id` (FK to the connection) and a denormalised
   `account_type_at_record` to `executed_trades`, written at creation time from
   the account that produced the trade. Existing rows stay NULL and are labelled
   "unattributed" — never guessed.
2. Where a trade came from a broker-side fill, populate both fields from the
   matching broker evidence row. Manual journal entries keep them NULL unless the
   user picks an account.
3. Performance and Trade History gain an explicit source scope: All /
   Demo accounts / Live + manual / Unattributed. Default view keeps today's
   behaviour but states plainly which sources are included, so a demo-inflated
   expectancy can never be read as a live track record.
4. Guide/docs note explaining that demo results are tracked separately and are
   not a live performance claim.

## Technical notes

- Migration adds the two nullable columns plus an index on
  `(user_id, connected_account_id)`; existing GRANT/RLS on `executed_trades` is
  unchanged since no new table is created.
- Scoping happens in the existing read queries (`src/lib/queries.ts`) and the
  performance aggregation input only; `src/lib/performance.ts` math, R semantics
  (`r_vs_plan` / `r_vs_actual_risk`) and the cluster bootstrap stay untouched.
- Backfill is derived-only where broker evidence exists; nothing is fabricated
  for rows without a broker link.
