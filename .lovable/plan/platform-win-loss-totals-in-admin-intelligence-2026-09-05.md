# Platform win/loss totals in Admin → Intelligence

Add a small panel at the top of Admin → Intelligence showing the same platform-wide
numbers I reported in chat, read live from the database each time the page is opened
(and refreshed automatically while it stays open).

## What the panel shows

Two blocks, side by side:

**Broker-verified (source of truth)**
- Wins, Losses, Breakeven
- Closed trades (total)
- Accounts with evidence
- Total gross P/L (with a "mixed currencies" note if accounts report in different currencies)

**In-app trade journal**
- Wins, Losses, Open, Total journal rows

A one-line note under the blocks explains that the broker block is what the broker
actually reported, that the journal is the in-app record and can lag behind while
trades are still open, and that zero rows renders zeros rather than any placeholder.

## Kept up to date

The panel refetches on page open and every 60 seconds while open, so it always
reflects current rows. Nothing is cached to a fixed value and no number is written
into the code.

## Scope

- Covers every connected account and every user (platform-wide), matching how the
  rest of the Intelligence page already reads data.
- Owner-only, like the other Intelligence panels.
- No changes to the scanner, execution, sizing, or any live/auto-trading switch.

## Technical detail

- New owner-gated read in `src/lib/admin.functions.ts` (`getAdminTradeTotals`):
  counts from `broker_trade_evidence` where `evidence_class = 'customer'` and
  `state = 'closed'` (win/loss/breakeven by broker net = gross + swap + commission,
  distinct `connected_account_id`, summed gross), plus outcome counts from
  `executed_trades`.
- Pure aggregation helper + unit test alongside the existing admin helpers, so the
  win/loss/breakeven classification is verified rather than trusted.
- New `src/components/admin/TradeTotalsPanel.tsx` using `PanelShell` and the shared
  `num`/`pctOf` formatters, mounted in
  `src/routes/_authenticated/admin/intelligence.tsx` above the existing auto-trader
  panel, wrapped in `PanelBoundary`.
- Add the panel to the mounted-panel documentation contract test.
