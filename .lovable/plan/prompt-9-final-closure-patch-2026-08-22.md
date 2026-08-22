# Prompt 9 — Final Closure Patch

Three defects, no redesign. Scanner, grading, replay, MetaApi, alerts, Prompt-7 research and all closed Prompt-8 statistics stay untouched.

## 1. Missing direction fails closed

Today both outcome writers coalesce a NULL snapshot direction to `"long"`, which silently fabricates trade geometry on legacy rows.

- Add `unavailable_no_direction` to `RAvailability` in `src/lib/journal/r-math.ts` and let `direction` be `"long" | "short" | null`. With a null direction, `computeR` returns both R values as NULL, `availability: "unavailable_no_direction"`, `stopProvenance: "unavailable"`, and skips stop-geometry assertions (which are direction-dependent).
- `src/lib/trade-journal.functions.ts`: delete the `?? "long"` fallback. When the snapshot direction is NULL and the row has a `signal_id`, read `direction` from the referenced `scanned_signals` row; use it only if the row still exists. If direction still cannot be established, write no R values, store `r_availability = 'unavailable_no_direction'`, and return that status in the result message truthfully.
- `src/lib/mcp/tools/update-trade-outcome.ts`: same fallback removal, same signal-row lookup, and the returned payload reports `r_availability: "unavailable_no_direction"` with a note saying direction could not be established so no R was computed.
- Direction is never inferred, defaulted, or derived from prices.

## 2. MCP one-sided prices are rejected

In `update-trade-outcome.ts`, before computing `hasPrices`, detect XOR of `actual_entry_price` / `actual_exit_price`. Exactly one supplied → return an `isError` validation result naming the missing field and perform **no** database update. One-sided input is never collapsed to null/null.

## 3. Truthful journal wording

`src/routes/_authenticated/history.tsx`:
- Badge text `Verified · you` / `Verified · agent` becomes `Self-reported · you` / `Self-reported · agent`; tooltips say self-reported, not broker verified.
- Rename the internal helper/state from unverified framing to price-backed framing and change user-visible copy: "no fill prices" panel says those results have **execution prices missing** and are excluded from your **price-backed** win rate (not "verified win rate"); the filter button reads "Show only trades missing prices".
- Sweep `src/routes/connect.tsx` and `src/lib/email-templates/verify-trade-prices.tsx` for the same "verified/unverified" implications and replace with self-reported / price-backed / execution prices missing.
- `plan_verified` semantics unchanged: replay/market-path consistency only, never broker execution verification.

## 4. Tests

- `src/lib/journal/__tests__/r-math.test.ts`: null-direction returns `unavailable_no_direction` with NULL R for both a would-be long and a would-be short price pair.
- New legacy-row regressions for the web journal writer: snapshot direction NULL + signal row present resolves the exact direction (long case and short case); snapshot NULL + signal gone yields `unavailable_no_direction` and never long.
- New MCP tests: entry-only rejected with no mutation, exit-only rejected with no mutation, both prices computes R, neither leaves R unavailable.
- Extend `src/lib/mcp/__tests__/provenance.test.ts` and add a UI-wording assertion so `Verified ·` cannot return to Trade History.

Then run lint, typecheck, build and the full blocking suite, and report the final total test count.
