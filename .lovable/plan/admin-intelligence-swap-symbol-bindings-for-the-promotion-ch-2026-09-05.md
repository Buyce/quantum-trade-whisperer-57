# Admin Intelligence: swap symbol bindings for the promotion checkpoint

## Are the three earlier ideas still useful?

1. **Switch on live execution and auto-trading** — not recommended now, and not part of this change. Nothing in the engine yet clears its own evidence bar: the filter comparisons still read "not yet decidable", there are no out-of-sample confirmations recorded, and the research backlog is still draining. Turning real money on before that evidence exists would be trading on unproven rules. The switch is already built and stays available for the moment the checks pass.
2. **Seed a full historical broker data period** — no longer needed, and it would break the project's own rule against inserting invented or bulk-loaded trading data. The replay engine now reaches back to the exact real candle window each setup needs, straight from the broker, and it has already resolved 429 setups that way. The rest drain on the hourly schedule with no seeding.
3. **Walk one setup end to end** — already achieved by the live runs: setups were captured, replayed against real broker candles, their paths written, and the verdicts are visible in Admin. Worth repeating only as a spot check, not as new work.

## What changes on the page

- **Remove** the "Broker symbol bindings" section from Admin → Intelligence.
- **Re-instate** the "Promotion checkpoint — data validation to shadow" section, which lists each instrument with what it has proven so far and exactly which requirements it still has to meet before its signals can be shown to customers.

## What stays true

- No scanner, alert, ordering or execution behaviour changes; both sections are read-only views.
- No data is deleted. Existing bindings stay in the backend and keep working during scans.
- Live execution and live auto-trading remain off.
- Each section keeps its own error boundary, so one failing section cannot blank the page.

## Technical detail

- Edit `src/routes/_authenticated/admin/intelligence.tsx`: drop the `SymbolBindingPanel` render and its `PanelBoundary` wrapper plus the now-unused import; add back `PromotionPanel` (from `@/components/admin/PromotionPanel`) inside a `PanelBoundary`, placed with the other readiness surfaces.
- `SymbolBindingPanel.tsx` and its server functions stay in the repo, unreferenced, so the binding surface can be re-mounted with a one-line change if a broker ticker ever needs naming again.
- Verify with a typecheck, the existing admin panel tests, and a build check.
