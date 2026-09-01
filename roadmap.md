# Roadmap

## Part A — Grade recovery for orphaned broker trades
- [x] Migration: `signal_grade_source`, `signal_first_decision_at`, `signal_ref`, one-time-fill trigger
- [x] `grade-recovery.ts` / `.server.ts` + tests, wired into `recover.server.ts` and `reconcile.server.ts`
- [ ] Backfill the 20 orphan evidence rows (writes `signal_ref`, not the FK `signal_id`)
- [ ] Surface recovered grades in Trade History with a provenance marker
- [ ] Performance: include recovered grades, report the recovered population separately

## Part B — Reduce "Not sent — refused by P-Trades"
- [ ] `next_attempt_at` + backoff on retryable refusals; claim RPC skips future-scheduled rows
- [ ] Terminalise runaway price gates; stop retrying when the window is shorter than the next step
- [ ] Batch/fair claiming so one hot symbol cannot starve the queue
- [ ] Move market-closed / spec-unavailable / window-floor checks to enqueue time
- [ ] Admin refusal-cost panel (reasons, attempts spent, queue latency)
- [ ] Settle the current pending backlog under the new rules
