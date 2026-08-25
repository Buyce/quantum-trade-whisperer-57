# Why the new instruments aren't selectable — and how to make the terminal honest about it

## What is actually true right now (verified in the deployed database)

- `execution_approved`: XAUUSD, GBPAUD, EURUSD — these are the only publishable, selectable instruments.
- `data_validation`: GBPUSD, AUDUSD, USDCAD, USDCHF, USDJPY — scanned and measured only. At this stage nothing they produce may reach a feed, an alert or an order.
- `disabled`: XAGUSD, USOIL, UKOIL, NAS100.

So the settings list is not broken. Feed filters are built from the Wave 0 list (`ALL_INSTRUMENTS` in `src/lib/db-types.ts`), which matches what is publishable. The five new pairs are deliberately absent because selecting them would promise signals the lifecycle forbids.

What *is* wrong is the Feed strip. It reads `instrument_health` rows — which exist for every scanned instrument — and labels all eight "live feed". That reads as "these are live for me", when for five of them it only means "the scanner can reach the broker feed while measuring".

## What this pass changes

1. **Honest feed-strip labelling.** Each instrument chip states its actual capability instead of a bare "live feed":
   - publishable + executable → "live feed"
   - scanned but not published (`data_validation`, `shadow`) → "measuring — not published yet"
   - feed unreachable → "feed down" (unchanged)
   A short line under the strip explains that measuring instruments are being validated and become selectable once promoted.

2. **Derive the settings instrument list from lifecycle stage, not a frozen wave constant.** The selectable list becomes "registry symbols whose stage allows publication", read from the existing stage source the terminal already loads. Today that resolves to exactly the same three symbols — no behaviour change now — but the moment a pair is legitimately promoted to `signals_only` it appears in Settings without a code edit. Fail-closed: if stages cannot be read, the list falls back to Wave 0 only.

3. **Guard the saved preference.** Saving keeps any already-selected symbol that is no longer publishable out of the effective set (eligibility already enforces this server-side); the UI just stops offering non-publishable symbols.

4. **Guide/FAQ line** explaining the three states a user can see: measuring, signal-only, execution-approved.

## Explicitly not in this pass

- No lifecycle promotion for any instrument. GBPUSD/AUDUSD/USDCAD/USDCHF/USDJPY stay at `data_validation`; Wave 2 stays `disabled`.
- No change to grading, sizing, alerts, caps or execution gates. Live execution stays disabled.
- No fabricated evidence, no forcing instruments into the feed before their evidence window completes.

## Technical notes

- `src/components/MarketStatus.tsx` — chip label derives from a stage-aware capability passed in with the health rows; presentational only.
- `src/routes/_authenticated/feed.tsx` — pass the stage per instrument (from the existing stage read) into `MarketStatus`.
- `src/lib/db-types.ts` — keep `ALL_INSTRUMENTS` as the fail-closed fallback; add a `publishableInstruments(stages)` helper using `mayPublish` from `src/lib/instruments/lifecycle.ts`.
- `src/routes/_authenticated/settings.tsx` — render the derived list.
- Tests: stage→label mapping, derived settings list equals the three approved symbols today, read-failure falls back to Wave 0, and a pin that `data_validation` symbols are never offered as selectable.
- Docs: `docs/INSTRUMENT-LIFECYCLE.md` gains the user-visible-state table; docs-contract test extended.

## When will they become selectable

Only after each pair's own evidence window completes and it is promoted through `shadow` to `signals_only`. That promotion is a recorded operator decision with evidence — this pass makes the UI ready for it, it does not perform it.
