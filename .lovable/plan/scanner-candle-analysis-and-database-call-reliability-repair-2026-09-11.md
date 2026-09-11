# Scanner, candle analysis, and database-call reliability repair

## Audit conclusion

**No — it is not yet responsible to guarantee that this cannot recur.** The latest repair improved recovery, and the newest completed cycle was healthy, but the live evidence still contains a worker cancellation and the current timeout design can recreate overlapping work.

### Verified live state at 05:40–05:45 UTC, 11 September 2026

- The database itself is not overloaded: 18/60 connections, 1/200 pooled clients, 30% disk use, no restarts, and 78% memory use. A larger database instance is not justified by this evidence.
- The scanner's ordinary workload is modest: nine instruments every 15 minutes, normally three candle windows each. In the last three hours, market-data reads recorded 57 successes and one timeout. There were no active leaked global candle slots when checked.
- The newest 05:30 cycle completed all nine jobs with no stale or failed rows. Its longest queue wait was 2m43s, safely inside the 15-minute freshness limit.
- The preceding 05:00 and 05:15 cycles were entirely stale. Across three hours, 95 of 117 jobs were discarded before analysis.
- Production recorded another `/api/public/worker/process` platform cancellation at 05:30:32: the runtime said the request had hung and would never respond. There were no further worker 502s in the following ten minutes, but that is not a long enough clean observation window to prove durability.
- Database-to-app traffic is much broader than scanning. In three hours it recorded 720 responses: 548 successful, 101 server failures, and 71 calls with no response. The current aggregate card does not reliably identify which scheduled function caused each failure.
- One unrelated but expensive database query used by execution enqueue checks averages about 596ms and has reached 7.3s. It is not the proven scanner root cause, but it should be explained and optimized if its query plan confirms a missing index.

## Root causes of the past failures

1. **Worker fan-out exceeded the broker's limit.** An earlier pre-work self-chain created 10–16 simultaneous workers against a provider limit of five historical-data requests per account.
2. **A worker could wait forever for a candle slot.** A cancelled request leaked in-memory capacity, causing later work to hang and receive 502 cancellations.
3. **Cancelled work held the queue too long.** The old 90-second worker lease and slower claim recovery let jobs age beyond the unchanged 15-minute freshness rule.
4. **Recovery consumed retry attempts.** Platform cancellations could eventually mark otherwise valid jobs failed.
5. **Health reporting mixed different meanings.** Successful timer SQL was treated as a successful app call, DNS was over-attributed, and all scheduled endpoints were aggregated together.
6. **Current residual defect: the 20-second deadline does not cancel work.** `Promise.race` returns a response and releases the lease, but the losing candle-analysis promise continues. A new worker can then acquire the lease while the old job is still running, recreating unintended concurrency.
7. **Current residual defect: throttles are classified as instrument failures.** Local/global candle-slot exhaustion and a final provider 429 are not recognized as transient capacity events. Repetition can incorrectly open a 15–60 minute instrument breaker.
8. **Current residual risk: global slot acquisition is not atomic.** Its count-then-insert function is not serialized, so simultaneous instances can theoretically admit more than five requests.
9. **Current observability gap:** every worker pass is logged with the same source, while health compares all pass rows with only the two drain timers. Triggered and self-chained calls can mask a missing scheduled call; “busy” is also counted as successful despite doing no work.
10. **Current timing mismatch:** the insert trigger waits only four seconds for a worker that commonly takes around 10 seconds. It can report a failed database-to-app call even when processing later completes.

## Safeguards already in place

- One database-backed worker lease, currently requested for 25 seconds and renewed after each completed job.
- Two queue-drain safety calls per minute, offset by 30 seconds, plus an every-minute abandoned-claim cleaner.
- Eight-second aborts on individual broker requests and bounded retries for idempotent reads.
- A local four-request gate and database-backed global five-slot budget for historical candle calls.
- Claims use `FOR UPDATE SKIP LOCKED`, preventing two workers from claiming the same queue row.
- Abandoned claims return to the queue without consuming an attempt; hard failure remains bounded at five attempts.
- The 15-minute freshness rule remains unchanged, so stale market observations are discarded rather than turned into misleading signals.
- Worker-pass records and recent scan outcomes now expose cancellations and stale work instead of treating them as “no trade.”

These measures reduce blast radius and speed recovery, but the residual defects above mean they are not yet a complete reliability guarantee.

## Repair plan

### 1. Make cancellation real and preserve single-flight

- Replace the non-cancelling deadline race with one request-scoped `AbortController` propagated through the worker, candle pipeline, slot wait, broker fetch, and retry sleeps.
- Stop claiming new work early enough to preserve response headroom.
- On deadline, abort the active operation, await its bounded cleanup, finish or safely return its claim, and only then release the worker lease.
- Never permit an old pass to continue after a successor acquires the lease.
- Remove unsupported fire-and-forget self-chaining; rely on the two guarded drain calls, or use the platform's supported background-task mechanism only if it can be verified end to end.

### 2. Make the five-request broker budget atomic

- Serialize global slot allocation inside the database function so concurrent callers cannot pass the count check together.
- Key and enforce the budget for the benchmark account, reclaim expired slots, and keep the TTL aligned with the maximum abortable request duration.
- Do not silently bypass the global cap when its store is unavailable. Record a transient capacity skip and retry on the next drain rather than risking another provider overload.

### 3. Classify capacity pressure correctly

- Give local wait expiry, global slot exhaustion, and provider 429 one typed `rate_limited`/`capacity` classification.
- Record these as transient operational skips, not instrument data failures.
- Ensure shared capacity pressure cannot increment an individual instrument's failure counter or open its circuit breaker.
- Preserve real symbol-specific errors and provider-wide outages as separate diagnoses.

### 4. Simplify and align trigger timing

- Keep the 15-minute scan endpoint lightweight and give it an internal deadline below its 10-second caller allowance.
- Change the four-second insert-trigger call so it only wakes the worker without falsely scoring a normal 10-second pass as failed, or remove it if the 0/30-second drain pair provides the safer single source of scheduling.
- Require the worker lease TTL explicitly and change the database default from the legacy 90 seconds, eliminating accidental reintroduction of the old lock duration.
- Add the missing partial index for processing claims by `started_at` after confirming the live query plan.

### 5. Make health reporting attributable and actionable

- Record each pass's real caller source: cycle trigger, primary drain, offset drain, or approved background continuation.
- Separate the Admin card into scanner calls and other scheduled app calls. Do not let successful dispatch, reconciliation, or reports hide scanner failures, or vice versa.
- Report `processed`, `idle`, `busy`, `deadline`, `error`, and “call produced no pass” separately; do not count `busy` as productive throughput.
- Add queue-service measures: oldest waiting age, p50/p95 queue wait, jobs completed per cycle, stale share, active lease age, active candle slots, and per-instrument missed cycles.
- Attribute non-scanner 5xx/no-response calls by endpoint before changing them; the present aggregate proves failures exist but not which sibling job owns all 172 failures.

### 6. Validate capacity rather than guessing

- Measure one complete market-hour under the real nine-instrument schedule and concurrent replay/account workloads.
- Verify the slow execution-enqueue query with `EXPLAIN`; add a targeted index only if the plan confirms it.
- Define alert thresholds from the actual service objective: every cycle starts within three minutes, finishes all instruments within ten minutes, zero platform-cancelled worker requests, zero stale jobs, no candle-slot count above five, and no instrument breaker caused by capacity throttling.
- Do not increase Lovable Cloud compute unless monitoring shows sustained memory pressure, connection saturation, or out-of-memory events. Current evidence does not.

### 7. Add failure-injection and regression tests

Test the exact incident classes rather than only happy paths:

- deadline abort stops the losing job before lease release;
- a timed-out pass cannot overlap its successor;
- simultaneous global slot acquisition never exceeds five;
- crashed slot holders expire safely;
- 429/local/global throttles do not trip instrument breakers;
- a cancelled claim is reclaimed without consuming an attempt;
- failed self-wake still drains within 30 seconds;
- one instrument failure cannot hide behind aggregate healthy results;
- current-cycle empty results never become a false “No Trade” claim;
- database/app health attributes failures to the correct endpoint.

## Acceptance period

After publishing, observe at least four consecutive market hours rather than declaring success after one cycle. Completion requires:

- 100% of scheduled cycles represented in the queue;
- zero stale or permanently abandoned jobs;
- zero worker 502/hung cancellations;
- p95 queue wait below three minutes and every cycle complete below ten minutes;
- no more than five concurrent historical reads for the benchmark account;
- no rate-limit event counted as an instrument failure;
- scanner-call health reconciling exactly with real worker-pass outcomes;
- other database-to-app failures identified by endpoint and repaired or explicitly isolated.

## Deliberately unchanged

- The 15-minute stale-data safety rule.
- Signal grading, expected-R, sizing, risk brakes, publication eligibility, order execution, and learning/replay mathematics.
- Real broker data only; no mock candles, synthetic signals, or placeholder trades.
