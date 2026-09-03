# Slim down Admin Intelligence

Remove five of the six circled panels from the Admin → Intelligence page so it loads lighter and scrolls shorter, while keeping the Broker symbol bindings surface.

## Panels removed from the page

- Refusal cost (7 days)
- Instrument lifecycle and telemetry
- Commissioning status
- Promotion checkpoint — data validation to shadow
- Economic events

## Panel kept on the page

- Broker symbol bindings — this is the only in-app surface for picking the exact broker ticker (e.g. NAS100 → USTEC) and triggering a recheck, so it remains accessible.

Each removed panel currently issues its own server read on page load, so dropping them removes five backend queries per visit.

## What stays true

- No scanner, alert, enqueue or execution behaviour changes. These panels are read-only views, so removing them changes nothing the engine does.
- No data is deleted. Lifecycle stages, promotion evidence, commissioning snapshots, refusal cost and news coverage all remain in the backend exactly as they are.
- Every other panel keeps its own error boundary, so one failing panel still cannot blank the page.

## Technical detail

- Edit `src/routes/_authenticated/admin/intelligence.tsx`: drop the `RefusalCostPanel`, `InstrumentDiagnosticsPanel`, `CommissioningPanel`, `PromotionPanel` and `NewsPanel` renders together with their `PanelBoundary` wrappers and now-unused imports. Keep `SymbolBindingPanel` and its wrapper.
- The panel component files stay in the repo, unreferenced, so they can be re-mounted with a one-line change later.
- Verify with a typecheck and the existing admin panel tests.

