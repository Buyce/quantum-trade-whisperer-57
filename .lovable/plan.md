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

### 2. Live news pipeline — official-source adapters, activated
Provider-neutral adapter contract (`providerId`, `sourceVersion`, `fetchEvents`, optional `fetchUpdates`, `health`) whose batch result distinguishes: events / no events / partial / throttled / outage / authorization failure / invalid response / stale upstream / missing exact time / unsupported country-family. An adapter may never turn incomplete data into healthy coverage.

- **FRED adapter** (official API only, server-side, `FRED_API_KEY` from the secret manager — never in code, logs, URLs shown in telemetry, docs or fixtures): release catalog, release dates, series-release relationships, observations and vintage/real-time dates. A versioned allowlist maps only approved releases/series to P-Trades event identities (FOMC, payrolls/employment, CPI, PPI, PCE, GDP, retail sales, industrial production, trade, jobless claims) — no indiscriminate catalog ingestion. FRED release dates are **dates, not intraday timestamps**: without an authoritative time the event is stored `timestamp_incomplete` and cannot authorise intraday suppression. No default time is invented.
- **EIA adapter** (`EIA_API_KEY`): discovered through the official catalog/metadata endpoints — weekly petroleum status (commercial crude, gasoline, distillate) with period and revision metadata, plus the authoritative publication schedule including holiday shifts; "Wednesday 10:30 ET" is never hardcoded. The owner-supplied crude-oil-imports URL is audited and classified as **monthly context**, not the weekly inventory event and not breaking news. Mapped to USOIL, UKOIL where the policy supports indirect exposure, and the energy correlation group. **OPEC stays a separate family with `unknown` coverage** until an authorised source exists.
- **Additional official sources** researched and documented (Fed, BLS, BEA, Census, ECB, BoE, BoC/StatCan, RBA/ABS, SNB, BoJ, exchange calendars for NAS100) in a feasibility matrix: URL, machine-readable mechanism, auth, rate limits, latency, schedule/timestamp/actual/revision availability, coverage, terms, reliability, cost, production vs research-only. No commercial-site scraping (Forex Factory, Investing.com) and no plugin adopted on name alone. I will come back for a decision only if two options differ materially in cost, licence or safety.
- **Coverage is per provider × country × currency × event family × instrument × window × freshness × source version** — states `healthy | partial | stale | unknown | provider_error | authorization_error | schedule_incomplete | timestamp_incomplete | unsupported`. No global `news_feed_healthy` boolean. A working FRED adapter does not make GBP, EUR, AUD, CAD, CHF, JPY, OPEC or earnings healthy.
- **Storage**: versioned `economic_events` (provider, provider event id, canonical identity, family, countries, currencies, affected instruments/correlation groups, importance, scheduled/original-scheduled/actual times, status, actual/forecast/previous, revision, units, ingestion and provider-update times, source and mapping versions, payload checksum, bounded diagnostics, per-field provenance), service-role-only grants under RLS. Idempotent upsert on stable provider identity — never on a mutable title. Revisions, reschedules, postponements, cancellations, duplicates, malformed/missing/future-dated timestamps and conflicting sources are all handled, and detection-time facts are preserved in an immutable revision ledger so nothing is re-judged with later revisions.
- **Scheduled ingestion** per provider cadence (never one fetch per scanner job), with bounded retries, rate-limit respect, exponential backoff, per-provider circuit breakers and an ingestion-run ledger (window, received, inserts, updates, duplicates, revisions, invalid, requests, retries, status, duration, error class, worker version). Provider health derives from real writes and freshness, not from a configured credential.
- **Policy wiring** re-evaluated with fresh state at every boundary — detection, shadow candidate, publication, MCP visibility, alert fan-out, execution enqueue and final broker submission — stamping snapshot version, policy version, event ids considered, coverage status, evaluation time and refusal reason. Required `partial`/`stale`/`unknown` coverage **fails closed for new Wave 1/2 entries**. The pipeline may be live while coverage is partial; trading authorisation must never treat partial as complete.
- **Wave 0 stays in dark comparison mode**: XAUUSD, GBPAUD and EURUSD record `would_allow` / `would_suppress` / `coverage_unknown` only, with zero change to publication, alerts or execution, until separate approval.

Rollout in the requested stages: adapter verification with real bounded responses → dark ingestion → coverage evaluation and admin diagnostics → Wave 0 comparison → Wave 1/2 research use. No global enforcement switch flipped because one provider works.

**Needed from you:** add `FRED_API_KEY` and `EIA_API_KEY` through the secret manager when I request them — do not paste either into chat.


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
