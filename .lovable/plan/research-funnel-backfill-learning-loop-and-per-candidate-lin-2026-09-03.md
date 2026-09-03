# Research funnel: backfill, learning loop, and per-candidate lineage

## What is true right now (verified)

- 1,322 candidates captured, detected from 2026-08-25 17:00 UTC to now. 586 carry a complete research plan and are waiting to be enrolled.
- Enrolment is on, budget 30 rows per run, and the hourly `shadow-resolve` job runs at :07. It last ran before the switch was flipped, so `Enrolled` is still 0. Enrolment already selects **oldest detection first** and stores the candidate's original detection time on the research execution; `enrolled_at` records when it was enrolled.
- The resolver only replays candidates on instruments production already fetched, and the candle depth it requests is computed from production rows only. Candidates older than that depth can never resolve today — they sit open forever.
- `filter_lift_stats` is empty, `recompute_filter_lift` is never called by the app or any cron job, and `get_admin_filter_lift` is not exposed in the app at all. This is the missing link: nothing currently learns from the rejected arm.
- No per-candidate view exists anywhere — only aggregate counts.

## 1. Drain the backlog with original timestamps

- Raise `candidate_rows_per_run` from 30 to 150 so the 586-row backlog clears in about 4 hourly runs, then return it to 30 once the backlog reads 0.
- No timestamp work is needed on the write path: detection time is preserved as-is and only `enrolled_at` uses "now". The plan adds a check to the funnel that the oldest enrolled candidate keeps its August detection date.
- The funnel gets full-history counts (currently only "last 24h" is prominent): oldest unenrolled candidate age, enrolled by day, and enrolable-vs-blocked split, so a backfill is visible as it drains rather than inferred.

## 2. Learn from the rejected arm (measure and recommend only)

- Call `recompute_filter_lift(24)` at the end of the hourly `shadow-resolve` run, after candidate resolution, inside the same bounded pass. Failures are recorded to research health and never affect the scanner.
- Expose the existing `get_admin_filter_lift` RPC through an admin server function and a new **Filter lift** panel: for each of the three testable gates (`risk_ceiling`, `headroom`, `reachable_r`), pass-arm vs fail-arm win rate, mean R, sample size, and a confidence interval.
- A gate reads as "loosening is supported" **only** when both arms are matured, each arm has enough samples, and the intervals do not overlap. Anything thinner is labelled "not yet decidable" with the missing sample count. No live threshold ever changes automatically — the panel produces a recommendation you approve, matching the existing promotion-gate discipline.

## 3. Track each candidate end to end

New owner-only read that returns one row per enrolled candidate:

| Stage | Source | For rejected candidates |
| --- | --- | --- |
| Scanner | candidate row: detected at, instrument, grade, gate that ended it | shown |
| Enrolment | `enrolled_at`, research plan id | shown |
| Replay outcome | research execution: status, filled, realized R, target touched | shown |
| Enqueue | auto-order decision row | "never sent — rejected by filter" |
| Broker fill / money | broker trade evidence | "no broker order exists" |

Honest boundary, stated in the UI: a rejected setup was never sent to a broker, so it has no fill and no money P/L. Its outcome is a replay-derived R from real candles under the frozen research ladder. Only candidates that were **published and auto-ordered** can show a real enqueue decision, fill and broker profit — those columns join through to the existing evidence tables so the two arms sit side by side.

## 4. Make stale candidates resolvable

- Include candidate rows in the replay depth calculation so a candidate detected days ago requests the depth it actually needs, capped at the existing maximum.
- Add a bounded historical top-up for backfill only: at most a small fixed number of extra candle fetches per hourly run (deepest-backlog instruments first), each under the standard 8-second timeout. This is a deliberate, budgeted exception to the "zero extra broker calls" rule, limited to the backfill and switchable off.
- Candidates still beyond the maximum depth are marked `outside_replay_window` instead of staying silently open, and counted in the funnel.

## Technical notes

- `src/lib/execution/shadow_resolve.server.ts`: candidate rows join the depth computation; new bounded candidate-only fetch budget with a per-run counter reported in the resolve summary; stale-window labelling.
- `src/routes/api/public/cron/shadow-resolve.ts`: add the `recompute_filter_lift(24)` call after resolution, error-swallowed into research health.
- New migration: `get_admin_candidate_lineage()` (admin-only, `SET statement_timeout`, paged) joining `research_candidates` → `shadow_executions` (cohort `research_candidate`) → `execution_enqueue_decisions` → `broker_trade_evidence` via the existing signal reference; funnel RPC extended with enrolled-by-day, oldest-unenrolled age and stale-window counts.
- `src/lib/admin.functions.ts`: `getAdminFilterLift`, `getAdminCandidateLineage`.
- New `FilterLiftPanel.tsx` and a lineage table section; both mounted on the admin intelligence route.
- Pure decision logic (lift decidability, lineage row shaping, stale-window classification) lives in testable modules with unit tests; no fabricated values anywhere — missing inputs render as explicit "not available" states.
- Budget change to 150 is a data update, reverted to 30 after the backlog clears.

## Verification after the next hourly run

- Funnel shows `Enrolled` moving up, with the oldest enrolled candidate still carrying its original August detection date and a fresh `enrolled_at`.
- Research executions in the `research_candidate` cohort appear and begin advancing; `outside_replay_window` count is explicit rather than hidden.
- Filter lift rows exist, each labelled decidable or not-yet-decidable.
- Scanner cycle, alerts, and auto-trade counters unchanged.
