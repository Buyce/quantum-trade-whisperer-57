# Fix: Stale research error banner in Candidate Panel

## Diagnosis (confirmed against production data)

- `shadow_engine_state.research_errors = 1`, `research_last_error = "observation write exceeded deadline"`, timestamped **2026-08-23** — over a week old.
- `model_observations` is healthy: V1/V2 = 2,284 rows each, V3 = 2,268, with 164 rows per model in the last 24h and the latest write today at 04:00 UTC.
- Root cause of the panel's red text: a single transient 500 ms deadline breach on Aug 23 (a slow `model_observations` upsert). `noteResearchFailure` latched it onto `shadow_engine_state`, and `CandidatePanel.tsx` renders `research_last_error` unconditionally — with no age and no success reset — so it looks like a live failure.
- The 500 ms `RESEARCH_WRITE_DEADLINE_MS` budget is doing its protective job (research writes can never stall a production scan) and is succeeding; it stays unchanged.

## Changes

1. **`src/components/admin/CandidatePanel.tsx`** — render the error honestly:
   - Show the error age alongside the message (e.g. "Last research error: observation write exceeded deadline — 11 days ago").
   - When the latest error is older than the last successful research activity (or older than 24h with the counter at a low value), render it muted/amber as "last recorded error" instead of the red live-failure styling, so a stale transient is not presented as a current outage.
2. **Counter reset on success** — in `src/lib/research/observations.server.ts`, after a successful `recordObservations` write, clear `research_last_error`/`research_last_error_at` (keep cumulative `research_errors`) via the same bounded, swallowing `noteResearchSuccess`-style update. New failures still latch; a recovered pipeline stops showing stale red text. Failure of the reset write itself is silently ignored (same contract as `noteResearchFailure`).
3. **Tests** — extend `src/components/admin/__tests__/panel-state.test.ts` (or a small new test) to cover: fresh error renders red with age; stale error (>24h) renders the muted "last recorded error" variant; cleared error renders nothing.

## Out of scope

- No change to the 500 ms deadline, the observation write contract, or production scan behaviour.
- No schema change; `shadow_engine_state` columns already exist.

## Verification

- `bunx vitest run` on the touched test files.
- Confirm the Admin Intelligence candidate panel no longer shows a red banner while `research_last_error` is null after the next successful observation write.
