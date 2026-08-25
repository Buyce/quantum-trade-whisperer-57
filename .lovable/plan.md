# P-Trades Master Completion — plan

## What the audit actually found (verified now, 2026-08-25 14:0x UTC)

- **HEAD is `d66dd48` ("Commissioned Wave 1/2 infra")**, not `56fb7fc`. The commit whose CI failed is several commits behind; working tree is clean.
- **CI is red for a real, mechanical reason.** CI runs `bun run verify` = `lint && typecheck && test && build`. `eslint .` currently reports **35 errors (all Prettier formatting) plus 24 warnings** across files including pre-existing ones (`cron/instrument-readiness.ts`, `cron/telemetry-rollup.ts`). Typecheck, blocking tests (1173 passed, 2 expected fail) and build are green locally. So the "1,158 tests pass locally" claim and the red CI are both true and do not conflict: **lint is the failing step**, not tests.
- **No live-news provider credential exists.** The only relevant environment values are Supabase and VAPID push keys. `src/lib/instruments/news-risk.ts` is a pure taxonomy, not an ingestion pipeline. Phase 3 therefore cannot go live under this authorization.
- Production state matches the commissioning report: `lifecycle_enforced=true` (audited RPC, rollback drilled), Wave 0 execution-approved, **AUDUSD in `data_validation`** with proven readiness, all other Wave 1/Wave 2 rows disabled, live execution off.
- Wave 1 GBPUSD/USDCHF/USDCAD/USDJPY have exact mappings and complete specifications but keep failing H4/H1 candle fetches on the 8-second provider timeout. NAS100/USOIL are ambiguous, UKOIL missing — no alias will be guessed.
- Evidence clock: AUDUSD has ~0 days. No instrument can legitimately reach shadow, signals, alerts or execution today.

Corrections to the prompt's assumptions: the reference SHA is stale; `lifecycle_enforced` is already true; AUDUSD is already in data_validation; the CI failure is lint, not tests or database suites.

## What this plan does now (all safe, reversible, dark)

### 1. Restore green CI (first, blocking everything else)
Fix the 35 formatting errors with the repo's own Prettier config and resolve the 24 warnings where they are genuine. No assertion weakening, no test deletion, no new eslint exclusions, no downgrading blocking tests. Then run the exact CI sequence — install from the committed lockfile, lint, typecheck, blocking tests (including the PostgreSQL 16 database suites), build, plus the non-blocking Intended-V2 report — and report exact counts, skips and expected-fails. Add a lint gate to the pre-existing test taxonomy suite so a formatting drift fails locally before it fails CI.

### 2. Provider-neutral live-news pipeline, dark and fail-closed
No authorized economic-calendar provider or credential exists, so no live events will be ingested or scraped. Build the whole path behind an adapter interface instead:
- versioned `economic_events` schema (provider, provider event id, canonical identity, family, countries, currencies, importance, scheduled/original/actual times, status, actual/forecast/previous, revision, ingestion and provider update times, source and mapping versions, payload checksum, bounded diagnostics) with RLS and service-role-only grants; no unbounded raw payloads, no secrets.
- idempotent upsert semantics, revision and cancellation/postponement handling, timestamp validation, stale-feed detection, retention.
- a versioned news policy: pre-event suppression, post-event cooldown, importance thresholds, event-family to instrument/correlation-group mapping, open-position and pending-order handling, and an explicit **unknown coverage = fail closed** branch.
- a `news_snapshot_version` + `news_policy_version` stamp recorded at detection time so no evaluation can ever be re-judged with later-revised data.
- Wave 0 behaviour is untouched: the policy runs in comparison mode only and never suppresses a Wave 0 signal.
Documented plainly as *implemented, dark, coverage unknown, blocked on provider authorization*.

### 3. Finish Wave 1 data_validation, evidence-driven only
Retry the commissioning readiness pass for GBPUSD, USDCHF, USDCAD and USDJPY in quieter provider windows with a bounded retry and a longer-but-still-capped history budget for H4/H1, then transition each individually through the transactional lifecycle RPC on a clean pass, one at a time, verifying the data-only prohibitions with database queries after each. XAGUSD follows the same path. NAS100, USOIL and UKOIL stay disabled until their provider symbols are disambiguated from recorded discovery evidence, and all Wave 2 energy/index instruments additionally stay disabled until broker-verified calendars exist.

### 4. Telemetry runtime proof
Prove each scheduled worker writes production rows: sampler attempts, spread samples with asset-correct units and invalid-sample classification, duplicate-timestamp handling, per-instrument caps, retention, aggregates and percentiles, session coverage, distinct trading days, missingness denominator, ATR snapshots (bounded, versioned, NULL when untrustworthy — never an M15 fetch per sample), capacity, heartbeat, queue age, provider error/throttle counts, resolver backlog and oldest unresolved age. Any table still empty is reported as non-functioning rather than described as working.

### 5. Outcome resolution, calibration and holdout infrastructure
Verify and complete the candidate-to-outcome state machine (pending entry, entered, target, stop, expired unfilled, cancelled, ambiguous, suspended-missing-data, terminal failure) with conservative same-candle ambiguity handling and ambiguity excluded from metrics that need a known result. Build the time-ordered calibration/holdout cohort separation and leakage guards (revised events, later mappings/specs, later candles, future sessions, correlated instruments) so that when evidence exists the evaluation is already honest. All dark.

### 6. Gates that stay closed today
Shadow, signals, alerts, demo execution and live execution all remain prohibited: their preconditions are real elapsed market evidence, and today AUDUSD has none. The path is built and tested; nothing is activated. Live-money execution needs a separate written authorization naming account, instrument, cohort, risk per trade, daily risk, exposure, order cap, mode, approver, duration and rollback conditions.

### 7. Documentation and tests, continuously
New/updated: `docs/NEWS-AND-EVENTS.md`, `docs/CALIBRATION.md`, `docs/OUTCOME-RESOLUTION.md`, `docs/FEATURE-FLAGS.md`, `docs/TELEMETRY.md`, plus updates to `ARCHITECTURE.md`, `INSTRUMENT-LIFECYCLE.md`, `MULTI-ASSET.md`, `OPERATIONS.md`, `SECURITY.md`, `MCP.md`, and a new dated audit report (existing reports preserved). Every capability is labelled implemented / deployed dark / active / evidence accumulating / blocked. Tests: CI parity, news ingestion idempotency/revision/cancellation/staleness/unknown coverage, detection-time news provenance, sampler runtime writes, missingness denominator, asset-class spread units, outcome transitions and gaps, ambiguity, resolver isolation, calibration/holdout separation and leakage, and RLS/grant coverage for every new object.

## Technical notes

- Lint fix is formatting-only via the repo's Prettier config; no rule set changes.
- News tables are service-role only; the admin surface reads them through an owner-gated SECURITY DEFINER function with a fixed `search_path` that authorizes the caller internally and returns no provider tokens, account ids or raw payloads.
- Database-linter findings will be classified as intentional (engine tables reachable only by the service role), defective, or deferred — no intentional service-role table will be opened to the Data API to silence a finding.
- Every lifecycle or flag change goes through `transition_instrument_stage` / `set_execution_control` with expected-previous, approver, reason, evidence and rollback target.

## Where this will stop

At the market-evidence gate. Expect the outcome: green CI, dark news pipeline, more Wave 1 instruments collecting data, telemetry proven, calibration/resolution infrastructure ready — and shadow/signals/alerts/execution still closed, with the earliest legitimate review date stated per instrument (Wave 0 and AUDUSD on/after 2026-09-01, later for anything transitioned after today).
