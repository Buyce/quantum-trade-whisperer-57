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

P-Trades Hub runs 100% on live broker data from the MetaApi scanner pipeline.

- Never add seed scripts, mock JSON fixtures, hardcoded signal arrays, demo
  generators, or fallback/placeholder setups for `scanned_signals`,
  `market_context`, or `executed_trades` — in migrations, server functions,
  routes, or components.
- Rows in `scanned_signals` may only be written by
  `src/lib/scanner/pipeline.server.ts` from real fetched candles.
- When a query returns 0 signals, that is a correct "No Trade" outcome. The feed
  MUST render the "Capital Preservation Mode Active" empty state and the
  performance dashboard MUST render zeroed metrics. Never synthesize rows,
  sample data, or skeleton "example" setups to make the UI look populated.
