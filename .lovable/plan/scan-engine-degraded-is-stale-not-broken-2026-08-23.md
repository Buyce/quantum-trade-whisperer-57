# Scan engine: "DEGRADED" is stale, not broken

## What the data actually shows

Your funding worked. Verified against the live scan queue:

- **Last failed cycle: 03:45 UTC.** Every cycle since then succeeded.
- Cycles at 04:00, 04:15, 04:24 and 04:30 all completed normally (`XAUUSD`/`EURUSD` = an identical active setup already published, `GBPAUD` = no structure satisfied the ABC grading rules). Those are healthy scanner outcomes, not errors.
- The shadow replay engine reads **RUNNING**, 0 consecutive failures.

So there is nothing to repair in the engine. The tile is telling the truth about a **rolling 60-minute window** that still contains the three pre-funding failures from 03:45. At roughly **04:45 UTC** those age out and the tile flips to RUNNING on its own.

The one genuinely misleading part is the amber billing banner underneath: it shows the last failure error from the window even though the scanner has been healthy for the last three cycles, which reads as "still broken right now".

## What to change (presentation only, no engine changes)

1. **Add a recovered state to the scan tile.** When the window has failures but the most recent finished cycle succeeded, show `RECOVERED` in the neutral/good-warn tone instead of `DEGRADED`, with a subline naming the facts: successes since the last failure, and how long ago that last failure was. Keep `DEGRADED` only for a window where failures are still interleaved with the latest cycles, `FAILING` when every cycle in the window failed, and `NO CYCLES` when the window is empty.

2. **Stop presenting a healed error as current.** Only render the amber provider/billing explanation when the last failure is newer than the last success. Once a success follows it, move the same text into a quieter "last failure in this window (since recovered)" line, still showing the raw provider message verbatim so nothing is hidden.

3. **Keep the window explicit.** The subline already says "in last 60m"; make it read unambiguously as a rolling window so a past incident inside it is never read as the engine's current state.

No changes to the scanner, the grading rules, the breaker, thresholds, or any stored data. No fabricated or substitute rows — the zero-hallucination rule is untouched.

## Technical notes

- `public.get_admin_engine_status` already returns `last_success_at`, `last_failure_at` and a window-scoped `last_error`, so the recovered state is derivable client-side with no migration.
- Work lands in `src/components/admin/EngineStatusPanel.tsx`, plus a small pure helper (next to `classifyEngineError` in `src/lib/engine-status.ts`) that maps the window counters into `RUNNING | RECOVERED | DEGRADED | FAILING | NO CYCLES` and a flag for whether the stored error is still current.
- New unit tests cover: failures present but latest cycle succeeded → `RECOVERED` with the error marked healed; failure after last success → `DEGRADED` with the error current; all-failed → `FAILING`; empty window → `NO CYCLES`.
