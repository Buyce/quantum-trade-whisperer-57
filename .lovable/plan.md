# Accelerated Commissioning — Wave 1 / Wave 2 Validation (Same Day)

## Audited current state (verified now, not from old reports)

- Repo HEAD `dbba003`, clean tree, 115 migrations.
- Lifecycle: XAUUSD / GBPAUD / EURUSD `execution_approved`; GBPUSD, AUDUSD, USDCHF, USDCAD, USDJPY, XAGUSD, USOIL, UKOIL, NAS100 all `disabled`.
- `execution_controls`: `lifecycle_enforced = false`, `live_execution_enabled = false`, `live_auto_enabled = false`, `demo_auto_enabled = true`, policy `single_exit_first_target`.
- `telemetry_controls`: sampler, aggregation, retention, capacity, readiness all already enabled; `sampler_symbols = {XAUUSD,GBPAUD,EURUSD}`; caps 3 instruments / 6 requests per run; daily budget 288.
- Evidence so far: 5 sampler runs, 10 spread samples. `broker_symbol_specs` exists but only Wave 0 rows.
- Cron/telemetry endpoints already exist (`api/public/cron/*`, `api/public/worker/*`); readiness, mapping, discovery and lifecycle transition helpers all exist.

Two real gaps blocking the requested procedure:

1. **No audited control path for `lifecycle_enforced`.** `set_telemetry_control` only accepts telemetry keys; `lifecycle_enforced` lives in `execution_controls` with no audited setter. The prompt requires an audited RPC, not a direct update.
2. **Admin diagnostics** does not yet surface per-instrument wave / mapping / spec / calendar-verification / blocker columns.

Everything else (registry, readiness sequence, fetch authority, provider-symbol authority, prohibition gates) is already built.

## What today's work delivers

### 1. Audited execution-control RPC
Add `set_execution_control(_key, _value, _changed_by, _reason, _expected_old, _evidence)` — allow-listed to `lifecycle_enforced` only, refuses on missing actor/reason, refuses when the expected previous value does not match, writes an `execution_control_changes` audit row, returns old/new. All flag flips today go through it.

### 2. Pre-switch no-op proof
Capture and record, before enabling enforcement: lifecycle rows, enforced scan universe (must equal Wave 0), user default instruments, degraded-read fail-closed behaviour for Wave 1/2, presence of lifecycle checks at publication / alert / enqueue / broker boundaries, Wave 0 heartbeat, latest scan, and current signal / shadow / delivery counts.

### 3. Enable enforcement + rollback drill
`false → true` via the RPC with the stated reason and rollback target, observe two full Wave 0 cycles (universe unchanged, no Wave 1/2 job, no duplicate Gold signal, no queue-age or provider-error spike), then `true → false → true` as the rollback drill, both transitions recorded. Labelled honestly as a same-day no-op and rollback proof, not a week-long baseline. If rollback misbehaves, restore `false` and stop.

### 4. Readiness discovery per instrument
Run the existing readiness sequence per disabled instrument: provider-symbol discovery (ambiguous aliases rejected), exact provider specification, digits/point/tick/volume-step/trade-mode validation, H4/H1/M15 candles and a live quote fetched by `providerSymbol`, source-timestamp freshness, conversion-leg live quotes, market/calendar state, quota headroom, per-instrument rollback test. Store mapping status + verified-at and specification as-of. Nothing invented — a missing mapping, spec or fetch authority leaves the instrument `disabled` with the exact blocker recorded.

### 5. Wave 2 calendar handling
For `data_validation` only, provider-reported market state plus source timestamps authorise raw collection. Static energy/index/metal calendars stay flagged unverified; an unverified calendar cannot authorise strategy evaluation, publication or execution, and closed-market/stale quotes are classified as invalid samples, never counted as spread evidence.

### 6. Sequential transitions
One transactional lifecycle RPC call per instrument, in order GBPUSD, AUDUSD, USDCHF, USDCAD, USDJPY, then XAGUSD, NAS100, USOIL, UKOIL. After each: wait a full scan/sampler cycle, add the symbol to `sampler_symbols` and raise instrument/request caps and the daily budget only as far as measured headroom allows, confirm data-only behaviour, compare Wave 0 duration and error metrics, then continue. Failure of one instrument isolates it and does not stop the rest.

### 7. Prohibition proof per activated instrument
Prove validation jobs run, provider symbol used, candles/quotes/spread samples/readiness snapshots/telemetry recorded — and prove zero V1/V2/V3 evaluation, research observation, research candidate, shadow execution, scanned signal, customer feed item, MCP item, email, push, execution delivery, bridge POST and MetaApi trade request. Any prohibited side effect rolls that instrument straight back to `disabled`.

### 8. Admin diagnostics extension
Extend `get_admin_instrument_diagnostics` and its admin panel to show per instrument: wave, stage, provider symbol, mapping status, spec status, candle quality, quote freshness, conversion readiness, calendar verification, sampler coverage, valid/invalid sample counts, breaker status, scan duration, queue impact, provider errors, promotion blockers, last successful readiness check. No tokens, account IDs, logins, raw payloads or stack traces.

### 9. Verification gate
Before any flag change: lint, typecheck, build, full suite, RLS/privilege, lifecycle-boundary, data-validation-prohibition, MCP-exclusion, alert-exclusion and broker-submission-exclusion tests, plus a migration replay check. Report totals, failures, skips, expected-fails (each explained individually) and duration. Stop on any failure touching lifecycle isolation, Wave 0 parity, data-validation restrictions, customer visibility, alerts, execution, RLS or provider-symbol authority.

## End-state flags

`lifecycle_enforced = true` (only if both proofs pass); telemetry schedules enabled and extended only to lifecycle-authorised instruments; Wave 1/2 shadow enrolment, publication, alerts, MCP visibility and execution all remain prohibited; global live execution and every real-money setting untouched.

## Final report

Starting/ending SHA, deployed migrations, exact flag changes with audit rows, rollback-drill evidence, schedules enabled, first successful telemetry run, provider request count and quota headroom, Wave 0 before/after, per-instrument readiness result, mapping, specification, lifecycle stage before/after, first valid sample, all blocked instruments with reasons, test results, database-linter findings, confirmation of zero unauthorised signal/alert/MCP item/delivery/broker request, and the earliest legitimate evidence-review date per instrument. Nothing is promoted beyond `data_validation` today.

## Note on honesty limits

Readiness for Wave 1/2 depends on live MetaApi responses. If the broker inventory has no unambiguous symbol or specification for an instrument (most likely for USOIL/UKOIL/NAS100 naming variants), it stays `disabled` with the blocker recorded rather than guessed into activation.
