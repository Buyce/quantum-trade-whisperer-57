# Enable research-candidate shadow enrolment

## Current state (confirmed against production)

- Capture is healthy: `candidate_capture_enabled = true`, 1,300+ candidates captured, ~164/day.
- `candidate_enrolment_enabled = false`; `candidate_rows_per_run` is already set to 30.
- Enrolable backlog: **586 candidates** carry a complete counterfactual plan (`cf_plan_version IS NOT NULL`) and are waiting for enrolment.
- The stale `research_errors = 1` latch clears itself on the next successful observation write (shipped this session).

## What enabling does

The hourly `shadow-resolve` cron already calls `enrolPendingCandidates` — with the flag off it is one flag read and a zeroed summary. Turning it on lets that existing call enrol up to 30 candidates per hour as forward-tested shadow executions in the `research_candidate` cohort:

- Every enrolled execution uses the common frozen research ladder (`legacy_best_target_touched`, `plan_origin='counterfactual'`) — never a traded plan.
- Executability is a fail-closed whitelist; NULL or unknown geometry is never enrolled.
- Idempotency is database-enforced (unique index on candidate + replay version + policy + origin).
- A failure records durable research health and can never affect the production scanner or resolver.

At 30/hour the 586-row backlog drains in ~20 hours of cron runs, bounded and resumable.

## Changes

1. **Production toggle (SQL)**: `UPDATE shadow_engine_state SET candidate_enrolment_enabled = true WHERE id = true;` — no migration needed; the column and guard rails already exist. No change to `candidate_rows_per_run` (30 is the reviewed ceiling).
2. **Verification**: after the next hourly `shadow-resolve` run, confirm via `research_candidates` (`enrolled_at` count rising), the funnel panel's `Enrolled` metric, and that `research_errors` stays at its baseline. Confirm `candidateEnrolment` in the cron response is non-zero and error-free.
3. **Rollback**: the same update with `false` restores the current dark state instantly; enrolled rows remain valid research data.

## Out of scope

- No code changes — the worker, gates, idempotency, and isolation are already implemented and tested.
- No promotion of any research cohort to production authority; research stays isolated from feed, journal, and Performance.
