<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

## Zero-Hallucination Data Rule (non-negotiable)

P-Trades Hub runs on live broker data from the MetaApi scanner pipeline. Every
number is broker-derived, engine-derived, replay-derived or self-reported, and is
labelled as such. Explicitly labelled estimates (for example margin) are allowed;
silently fabricating an unavailable financial input is not.

- Never add seed scripts, mock JSON fixtures, hardcoded signal arrays, demo
  generators, or fallback/placeholder setups for `scanned_signals`,
  `market_context`, or `executed_trades` — in migrations, server functions,
  routes, or components.
- Rows in `scanned_signals` may only be written by
  `src/lib/scanner/pipeline.server.ts` from real fetched candles.
- Never synthesize rows, sample data, or skeleton "example" setups to make the UI
  look populated. Zero rows renders a zero state; the performance dashboard
  renders zeroed metrics.

### Empty result semantics (do not blanket-claim "No Trade")

A query returning zero rows only means **nothing matched that query**.

- A **filtered, capped, paged or settings-scoped** empty view (user instruments,
  sessions, minimum grade, daily cap, retention window, `list_signals` filters)
  may only say that no rows match this view. It may never say "No Trade",
  "Capital Preservation Mode Active", or anything about the scanner's cycle.
- A scanner-wide **No Trade** claim is only permissible from an unfiltered,
  current-cycle source, and the scanner heartbeat
  (`get_scanner_status` / the in-app heartbeat) is the authority on whether the
  engine is cycling at all.

Enforced by `src/lib/mcp/__tests__/list-signals.behavior.test.ts` and
`src/test/__tests__/docs-contract.test.ts`.
