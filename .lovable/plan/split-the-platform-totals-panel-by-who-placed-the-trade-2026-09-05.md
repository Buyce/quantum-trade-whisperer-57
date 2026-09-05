# Split the platform totals panel by who placed the trade

Break the "Platform totals — all connected accounts" panel into automatic-trader
results versus user results, without changing any number that is already shown.

## What the live data actually says

Checked before writing this plan: all 118 closed broker-verified trades were placed
through P-Trades (they all carry the platform's own order tag). Of those:

- 98 are still linked to the automatic dispatch record — unambiguously auto-trader.
- 20 lost that link when their setup row was purged, so the broker still proves the
  money but nothing proves which run placed them.

There are currently no broker trades that a person placed by hand in their own broker
terminal, so the panel must not invent a "manual" bucket out of broker evidence. The
user-side ledger is the in-app journal, which is what people record themselves.

## New layout of the panel

Three blocks instead of two:

**Automatic trader (broker-verified)** — wins, losses, breakeven, closed trades,
accounts, gross P/L, for trades still linked to an automatic dispatch.

**Unlinked broker trades (broker-verified)** — same figures for the trades whose
dispatch link was lost. Shown separately, with a one-line note that they were placed
by P-Trades but can no longer be attributed to a run, so they are neither claimed as
auto-trader wins nor as user wins.

**In-app trade journal (user-recorded)** — unchanged: wins, losses, breakeven, open,
total rows. Labelled as the record people keep themselves.

An "All broker-verified" total line keeps the current headline figures (54 / 64 / 118
/ 2 / +4,913.29) visible, so nothing that is on screen today disappears.

If a broker trade ever appears with no P-Trades tag at all, it lands in a fourth
"placed outside P-Trades" block automatically — the split is computed from the data,
not hardcoded.

## Scope

- Owner-only, platform-wide, still refreshed every minute.
- Read-only: no change to the scanner, execution, sizing, or any live/auto-trading switch.
- No number is written into the code; zero rows renders zeros.

## Technical detail

- `src/lib/admin/trade-totals.ts`: add an `attribution` field to `BrokerEvidenceRow`
  (`auto` when `delivery_id` is present, `unlinked` when the platform tag is present
  but the delivery link is gone, `external` otherwise) and a
  `aggregateBrokerTotalsByAttribution()` that returns `{ auto, unlinked, external, all }`,
  each an existing `BrokerTotals`. `aggregateBrokerTotals` stays as-is and is reused
  per bucket, so the current classification and mixed-currency refusal are unchanged.
- `src/lib/admin/__tests__/trade-totals.test.ts`: add cases for bucket routing, empty
  buckets, and that the buckets sum back to the combined total.
- `src/lib/admin.functions.ts` (`getAdminTradeTotals`): select `delivery_id`,
  `signal_id` and `association_basis` as well, derive the attribution, and return the
  bucketed shape.
- `src/components/admin/TradeTotalsPanel.tsx`: render the blocks; buckets with zero
  closed trades are hidden rather than shown as empty columns.
