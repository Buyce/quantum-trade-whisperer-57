# Enable research-candidate shadow enrolment

## Answer to: does this affect the scanner, alerts, or auto-trading?

**No.** The isolation is structural, verified in code:

- **Scanner / alerts / auto-trade**: untouched. Enrolment runs only inside the hourly `shadow-resolve` cron, after production resolution, in its own try/catch — an enrolment failure cannot even re-label the cron run as failed. It writes only research tables (`research_candidates`, cohort-tagged `shadow_executions`). Production reads use cohort-scoped queries (`cohort = 'production'` explicitly), so research rows can never enter the feed, alerts, eligibility, journal, or Performance.
- **No new MetaApi calls**: candidate replay reuses the exact candle array production already fetched for that instrument — "zero incremental provider calls" is a hard requirement in the resolver. Candidates whose instrument production isn't fetching this hour are counted as backlog, not fetched.
- **No capacity theft**: production rows load first from a production-only query; candidates have their own bounded budget (`candidate_rows_per_run`, 30/hour) loaded last. Research can never consume a production slot.
- **No claim collisions**: candidate claims use their own model-version namespace (101), so they can't consume V1/V2/V3 claim slots.
- **No trade-path involvement**: enrolled rows get `plan_origin='counterfactual'`, are replayed under the frozen research ladder only, and are never eligible for execution delivery.

The only real cost is **database work inside the hourly cron** (up to 30 extra enrolments + up to 30 candidate row updates per run) — bounded, and the cron already carries that headroom. No extra broker/API spend, no user-visible change, no new failure modes in trade placement.

## Current state (confirmed against production)

- Capture healthy: `candidate_capture_enabled = true`, 1,300+ candidates, ~164/day.
- `candidate_enrolment_enabled = false`; `candidate_rows_per_run` already 30.
- Enrolable backlog: **586 candidates** with complete counterfactual plans waiting.
- Enrolled rows resolve as they mature: open candidate rows advance only when production is already fetching that instrument, so they trail live activity naturally.

## Changes

1. **Production toggle (SQL)**: `UPDATE shadow_engine_state SET candidate_enrolment_enabled = true WHERE id = true;` — column, budget, guards, and cron call already exist. No code change, no migration.
2. **Verification**: after the next hourly `shadow-resolve` run, confirm `enrolled_at` counts rising in `research_candidates`, the funnel panel `Enrolled` metric moving, `candidateEnrolment` non-zero and error-free in the cron response, and `research_errors` unchanged.
3. **Rollback**: set the flag back to `false` — instant; enrolled rows remain valid research data.

## Out of scope

- No promotion of any research cohort to production authority; research stays isolated from feed, journal, Performance, and execution.
