# Phase A2 — Data Validation, Telemetry and Controlled Shadow Activation

## Audit findings first (verified against live code and database, not the plan)

Head commit: `e553811`. Everything below was read this turn.

Prerequisites that check out:
- Lifecycle stages live: XAUUSD / GBPAUD / EURUSD = `execution_approved`; GBPUSD, AUDUSD, USDCHF, USDCAD, USDJPY = `disabled`.
- `execution_controls.lifecycle_enforced = false`, `live_execution_enabled = false`.
- `scanned_signals` rows for non-Wave-0 instruments: **0**. `research_candidates`: **0** (capture is still dark).
- Capability matrix in `src/lib/instruments/lifecycle.ts` already separates collect / evaluate / capture / resolve / publish / alert / execute, and `data_validation` grants collect only.
- Atomic transitions exist: `transitionStage` delegates to the `transition_instrument_stage` function (compare-and-set, reason + approver required, history row in the same transaction).
- Mapping and specification are separate readiness facts (`mapping.server.ts` vs spec checks in `readiness.server.ts`); precision is instrument-aware (`precision.ts`, USDJPY `fallbackDigits: 3`).
- Build, type-check and 1088 tests pass.

Corrections to this brief:
1. `shadow_executions` holds **484** rows, not 482. None are Wave 1.
2. There is no spread-telemetry table of any kind yet (`signal_user_telemetry`, `account_telemetry_snapshots`, `telemetry_budget` are unrelated). A2.1 is greenfield.
3. Cron schedules are not readable from the app role (`permission denied for schema cron`), so sampler cadence must be provisioned as a new scheduled endpoint and documented, not inferred from a crontab read.
4. Validation order: I keep your order but with a stated reason — GBPUSD and AUDUSD are USD-quoted (no quote-currency conversion for a USD account), USDCAD/USDCHF need one conversion leg, and USDJPY is last because it is the only 3-digit tick grid. Nothing in the data supports a different order.
5. Phase A2 **cannot** finish inside one build. Everything after the enforcement proof is time-gated by real trading days; the plan ends by parking at the first real gate and reporting "evidence still accumulating".

## What gets built (dark first, in this order)

### 1. Spread and transaction-cost telemetry (A2.1)
- `instrument_spread_samples`: canonical instrument, provider symbol, non-secret provider scope, stage at sample time, bid/ask/mid/spread as `numeric` (never float), spread in points and pips, broker digits/point/tick, spread-to-M15-ATR only when a trustworthy ATR snapshot exists, session + session version, source and received timestamps, mapping verified-at, spec as-of, market state, quality status, rejection reasons, sampler version. Unique key on (instrument, provider scope, source timestamp, sampler version) so retries cannot double-count.
- Invalid / stale / future-dated / closed-market samples are stored with a quality status and are excluded from every statistic by construction (aggregates read a valid-only view).
- `instrument_spread_stats`: versioned aggregates by instrument x session x session version x research period x trading date, with raw/valid/excluded counts, distinct trading days, session coverage, missingness, median, p75/p90/p95/p99, max, median and upper-tail spread-to-ATR, computation version, coverage window. One documented percentile definition (nearest-rank on the valid sample set), pinned by test.
- Retention: raw samples bounded after a measured storage calculation; aggregates kept. Retention worker runs in bounded idempotent batches with deletion metrics. It may delete telemetry only — never signals, trades, candidates or outcomes.
- Hard isolation: telemetry is read by nothing in grading, publication, alerting, sizing or execution. Wave 0 spread floors stay exactly as registered.

### 2. Sampler and provider budget (A2.2)
- Before choosing a cadence, measure: provider limits, current scan/spec/quote request consumption, latency, retries, worst-case amplification, DB writes, worker runtime. Cadence is then written as configuration, stage-aware: `disabled` none, `data_validation` validation cadence, `shadow` research cadence, Wave 0 unchanged.
- Dedicated `worker/spread-sample` endpoint so samples are not taken only at scan moments, reusing an existing quote when its provenance and timestamps are trustworthy.
- Per-run request and row caps, per-instrument isolation, timeout, bounded retries, provider-outage detection, breaker compatibility, stale-job rejection, kill switch, metrics.

### 3. Provenance population (A2.3)
Populate the Phase A1 provenance columns for **new** rows only, and only where truthfully known: instrument, actual provider symbol, non-secret scope, stage at detection, cohort, model version, manifest hash, deploy id, session version, candle source, candle as-of per timeframe (max closed candle timestamp, not receipt time), quote as-of, spec as-of, mapping verified-at, run id, observation key, feature version. No backfill; historical nulls stay the documented legacy unstamped cohort.

### 4. Stage-correct capture and one outcome authority (A2.4, A2.5)
- Candidate capture stays refused below `shadow`; `data_validation` produces neither evaluation nor candidate. Research write failures are caught and counted, never allowed to change the production scanner result.
- Explicit cohort labels so statistics cannot pool Wave 0 production, Wave 0 research, Wave 1 lifecycle shadow, V1/V2/V3, counterfactual vs published, and legacy unstamped.
- No new outcome table: `research_candidates` stays immutable detection evidence, `shadow_executions` stays plan + resolution state, statistics derive from resolved rows. Existing 484 rows are untouched and separable by cohort.
- The resolver state machine is specified and tested end to end: pending, never filled, filled, TP1/TP2/TP3, stopped, expired, cancelled on data invalidity, same-candle ambiguity, missing-candle suspension, provider outage, unresolved/manual review — with explicit rules for eligible-fill start, expiry, candle ordering, bid/ask vs mid, gaps through entry/stop/target, grid normalization, session boundaries, late candles, idempotency and resolver version. Ambiguity resolves to the conservative or explicitly unknown outcome, never the profitable reading.
- Resolver isolation: per-instrument batching, bounded pagination, retry limits, backlog age and oldest-unresolved metrics, breaker compatibility, kill switch.

### 5. Admin diagnostics (A2.6)
Admin-only instrument diagnostics page under the existing admin routes, fed by a `SECURITY DEFINER` function with fixed `search_path` and an in-function admin check: stage, capabilities, last transition + reason + approver, provider symbol, mapping status and verified-at, spec freshness, digits/point/tick, quote freshness, candle quality per timeframe, conversion readiness per supported account currency, breaker status, sampling coverage, valid/invalid counts, distinct trading days, session coverage, percentiles, candidate count, unresolved count and oldest age, resolver health, scan duration, queue age, provider error rate, promotion blockers, last readiness run. No provider account ids, logins, tokens, raw payloads or stack traces anywhere. Transition actions go through the Phase A1 RPC with an explicit reason and expected current stage.

### 6. Capacity baseline (A2.7)
Record a real Wave 0 baseline with distributions (p50/p95/p99, not averages): job and cycle duration, queue age, stale-job rate, timeouts, chain depth, provider requests/errors/throttles, candle and quote failures, DB write failures, alert and enqueue latency and failure rates, resolver throughput/backlog/oldest age, breaker events, Wave 0 publication, alert and execution-decision distribution. Define absolute and baseline-relative safety limits before any Wave 1 work.

### 7. Enforcement no-op proof, then activation (A2.8–A2.11)
- Flip `lifecycle_enforced` only after 1–6 are deployed dark with green tests, and only after runtime proof: Wave 1 all `disabled`, Wave 0 all `execution_approved`, computed enforced universe identical to today's Wave 0 universe, user defaults unchanged, `data_validation` cannot evaluate, `shadow` cannot publish/alert/execute, degraded lifecycle reads fail closed for Wave 1, publication and execution boundaries re-read stage, rollback drill passes. Record approver, reason, commit and pre-switch metrics; observe one representative production period; revert on any Wave 0 regression.
- Then one instrument at a time to `data_validation` via the RPC, each with its own readiness evidence, followed by verification that it produced no evaluation, no candidate, no signal, no alert, no MCP item, no delivery and no broker request.
- `data_validation -> shadow` requires a frozen evidence package: >= 10 completed trading days (20 preferred before any tail claim), coverage in every relevant session, enough per-session observations for median and upper tail, stable unambiguous mapping, fresh spec, valid digits/point/tick, no systematic candle gaps, no unresolved grid failure, no sustained breaker, no Wave 0 capacity regression, no growing backlog, plus stated uncertainty and limitations. Row count alone never qualifies.
- Spread-floor recommendations are computed and documented but never written to the registry.

### Tests
Every item on your required-test list gets a test, including USDJPY spread units, percentile determinism, sampler idempotency/caps/kill switch, stage sampler rules, provenance and legacy nulls, cohort separation, resolver state transitions and ambiguity, per-instrument isolation, admin authorization and security-definer restrictions, enforcement no-op, and the prohibitions on Wave 1 publication, alerting, MCP visibility, delivery and broker submission. Wave 0 golden parity and user-preference protection stay blocking.

## Where this build stops

Implementation ends at the first real time gate. Expected end state: infrastructure deployed dark, enforcement proven neutral and enabled, GBPUSD moved to `data_validation`, every other Wave 1 instrument still `disabled`, and a report naming evidence accumulated, evidence missing, earliest legitimate re-evaluation date and the monitoring queries to watch. No instrument reaches `shadow` in this build unless real elapsed data supports it. Nothing advances past `shadow` at all.

## Technical notes

- All schema arrives as additive migrations with grants (`service_role` full, no `anon`), RLS enabled, and admin reads only via the definer function.
- New scheduled endpoints follow existing conventions under `/api/public/cron/*` and `/api/public/worker/*` behind the cron secret.
- Numeric columns use `numeric`, never `double precision`, for prices, spreads and percentiles.
- Zero-hallucination rule holds throughout: no seeded samples, no synthetic candidates, no fabricated outcomes, no invented provenance.
