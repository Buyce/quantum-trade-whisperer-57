# Roadmap

## Part A — Grade recovery for orphaned broker trades
- [x] Migration: `signal_grade_source`, `signal_first_decision_at`, `signal_ref`, one-time-fill trigger
- [x] `grade-recovery.ts` / `.server.ts` + tests, wired into `recover.server.ts` and `reconcile.server.ts`
- [x] Backfill the 20 orphan evidence rows (writes `signal_ref`, not the FK `signal_id`)
- [x] Surface recovered grades in Trade History with a provenance marker
- [x] Performance: include recovered grades, report the recovered population separately

## Part B — Reduce "Not sent — refused by P-Trades"
- [x] `next_attempt_at` + backoff on retryable refusals; claim RPC skips future-scheduled rows
- [x] Terminalise runaway price gates; stop retrying when the window is shorter than the next step
- [x] Batch/fair claiming so one hot symbol cannot starve the queue
- [x] Move market-closed / spec-unavailable / window-floor checks to enqueue time
- [x] Admin refusal-cost panel (reasons, attempts spent, queue latency)
- [x] Settle the current pending backlog under the new rules (fair claiming now serves the 14 never-claimed 0-attempt rows before the hot row; nothing is force-settled by hand)
- [x] Enable research-candidate enrolment (flag flipped, verify on next hourly run)
- [x] Research backlog drain: candidate budget raised to 150/run, oldest detection first
- [x] Filter lift recomputed hourly after research resolution + admin Filter Lift panel (measurement only)
- [x] Per-candidate lineage panel (capture -> enrolment -> replay -> broker, "never sent" when rejected)
- [x] Rows older than the provider candle cap labelled `outside_replay_window` instead of sitting pending
- [ ] Restore `shadow_engine_state.candidate_rows_per_run` to 30 once the enrolable backlog reaches 0

