# Slim down Admin Intelligence

Remove the six circled panels from the Admin → Intelligence page so it loads lighter and scrolls shorter.

## Panels removed from the page

- Refusal cost (7 days)
- Instrument lifecycle and telemetry
- Commissioning status
- Broker symbol bindings
- Promotion checkpoint — data validation to shadow
- Economic events

Each of these currently issues its own server read on page load, so removing them also removes six backend queries per visit.

## What stays true

- No scanner, alert, enqueue or execution behaviour changes. These panels are read-only views (bindings/recheck aside), so removing them changes nothing the engine does.
- No data is deleted. Lifecycle stages, bindings, promotion evidence, commissioning snapshots and news coverage all remain in the backend exactly as they are.
- Every other panel keeps its own error boundary, so one failing panel still cannot blank the page.

## One thing to confirm

The Broker symbol bindings panel is the only in-app surface where you pick the exact broker ticker for an instrument (the NAS100 → USTEC style decision) and trigger a recheck. Removing it means that action is no longer available from the terminal until it is put back. If you would rather keep that one and drop the other five, say so and I will adjust.

## Technical detail

- Edit `src/routes/_authenticated/admin/intelligence.tsx`: drop the `RefusalCostPanel`, `InstrumentDiagnosticsPanel`, `CommissioningPanel`, `SymbolBindingPanel`, `PromotionPanel` and `NewsPanel` renders together with their `PanelBoundary` wrappers and now-unused imports.
- The panel component files stay in the repo, unreferenced, so they can be re-mounted with a one-line change later.
- Verify with a typecheck and the existing admin panel tests.
