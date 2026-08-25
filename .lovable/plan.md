# Complete Wave 1 — Stage B: provenance, conversion and symbol authority (the part that can honestly be built today)

## What the audit found (verified, not assumed)

Starting commit: `a24414a`, clean working tree, 113 migrations on disk.

Confirmed live state:

- Lifecycle: XAUUSD, GBPAUD, EURUSD are `execution_approved`; GBPUSD, AUDUSD, USDCHF, USDCAD, USDJPY are all `disabled`. Wave 0 is exactly as this prompt expected.
- `execution_controls`: `lifecycle_enforced = false`, `live_auto_enabled = false`, `live_execution_enabled = false`, `demo_auto_enabled = true`.
- Telemetry controls: sampler enabled, `sampler_symbols = [XAUUSD, GBPAUD, EURUSD]`, `max_instruments_per_run = 3`, `max_requests_per_run = 6`, `daily_request_budget = 288`. Wave 1 is not sampled.
- All 14 cron jobs are active, including 15-minute spread sampling, hourly rollup and daily readiness snapshots.
- Row counts: `spread_sampler_runs` = 1 (first and only scheduled slot `2026-08-25 12:15Z`), `instrument_spread_samples` = 3, `instrument_spread_stats` = 0, `instrument_atr_snapshots` = 0, `instrument_readiness_snapshots` = 0, `scanner_capacity_samples` = 1, `research_candidates` = 0.

**The baseline started roughly 25 minutes ago.** Sections 8 through 16 of your prompt (Wave 0 evidence week, A2B enforcement checkpoint, sequential `data_validation` transitions, Wave 1 evidence, shadow, signals-only, execution approval) are gated on a full trading week of real Wave 0 evidence that does not exist yet, and on 10 to 20 completed trading days per Wave 1 instrument after that. None of it can be executed now without fabricating elapsed time, so this plan does not attempt it.

Three genuine implementation gaps are blocking, and all three can be closed today:

1. **Provenance is declared but never written.** `model_observations` has 2,732 rows and `candle_policy_version`, `candle_as_of`, `provider_symbol`, `quote_as_of`, `spec_as_of`, `mapping_verified_at` are populated on **zero** of them. `research_candidates` has the same columns, also unwritten. The scanner pipeline stamps none of them.
2. **Symbol authority is only half-wired (R8).** `resolveFetchSymbol` exists and is used by the spread sampler and the readiness snapshotter only. The scanner pipeline and the shadow resolver still fetch by canonical name, which is exactly the defect R8 was written to stop.
3. **Conversion readiness is route-only (R5).** Readiness proves a route exists (`planConversion`), but never fetches a live quote for the conversion legs, so there is no live-conversion-data readiness and no execution-conversion readiness distinct from it.

## What this stage builds

### 1. Candle-policy and provenance stamping (R7)

Extend the existing versioned candle policy so every detection carries an as-of snapshot per timeframe, and stamp it at write time on new rows only.

- A detection-time provenance record: policy id and version, H4 / H1 / M15 as-of timestamps, detection time, whether a forming candle was included, calculation version, provider symbol actually fetched, quote and spec as-of, mapping verified-at.
- Written on new `model_observations` and `research_candidates` rows. The 2,732 existing rows stay `NULL`, which is how a legacy unstamped row remains distinguishable from a Wave 1 cohort — no backfill, no rewrite.
- Wave 0 grading keeps the existing forming-candle policy byte-for-byte. The closed-candle Wave 1 research policy is registered but not activated for any instrument, and cohorts never mix finality.

### 2. Full symbol authority (R8)

Route the scanner pipeline and the shadow resolver through `resolveFetchSymbol`, so the symbol verified during readiness is the symbol used for candle fetches, quote fetches, spread sampling, conversion legs, spec refresh and resolver fetches. Unresolved, missing or ambiguous mappings refuse the read rather than defaulting to the canonical name. Wave 0 mappings resolve to their current provider symbols, so Wave 0 behaviour is unchanged.

### 3. Live conversion readiness (R5)

Split conversion readiness into three explicitly named layers:

- **route** — a plan exists (today's check, unchanged);
- **live data** — every leg of the route returns a quote with valid geometry, a positive spread, a provider source timestamp that is fresh and not future-dated, and a correct inversion where the route inverts;
- **execution** — live data plus broker/account scope and agreement with the sizing service.

Data-validation readiness may report a missing or stale route as a blocker. No rate is ever synthesised, and execution stays refused without live conversion readiness.

### 4. Telemetry truthfulness

The sampler already classifies `closed_market`, `malformed`, `crossed`, `stale`, `future_dated` and records expected / attempted / succeeded per run, so missingness already has a real denominator. This stage adds only what is genuinely absent: resolver-health rows from the shadow resolver, and duplicate-provider-timestamp classification for repeated identical source times.

### 5. Tests

New blocking tests for: candle-policy stamping and non-backfill of legacy rows; forming versus closed cohort separation; symbol authority (exact, alias, prefix, suffix, multiple candidates, missing, readiness/fetch mismatch, account-specific mapping, scanner mapping distinct from execution mapping); conversion cases (missing, stale, future, invalid, crossed, unparseable timestamp, unsupported currency, missing mapping, unavailable cross, inversion error); and Wave 0 parity — identical structure keys, grades and publication decisions before and after.

Then lint, format check, typecheck, build and the full suite, reporting expected-fail and skipped tests individually.

## What this stage deliberately does not do

- No lifecycle transition for any instrument. All five Wave 1 pairs stay `disabled`.
- `lifecycle_enforced` stays `false`.
- No Wave 1 sampling, no spread floor written into the registry, no news layer yet (it is only needed before `signals_only`).
- No promotion of anything.

## Technical notes

- One additive migration only, if needed for resolver-health and duplicate-timestamp columns. No column on `scanned_signals`, `shadow_executions` or resolved outcomes is rewritten.
- Stamping happens inside the existing atomic RPCs' callers, before the enrolment call, so a refused lifecycle gate still writes nothing.
- The scanner pipeline's fresh `assertCapability` re-read before every side effect stays exactly where it is; symbol resolution is added alongside it, not in place of it.

## Time gate and what happens next

The Wave 0 baseline began `2026-08-25 12:15 UTC`. One genuine full trading week ends on or after **Monday 2026-09-01**, which is the earliest legitimate A2B review date. At that point the report will state evidence collected, evidence missing, and the safe current state — and only then does the A2B enforcement checkpoint, followed by sequential Wave 1 `data_validation`, become executable. Wave 1's own 10-to-20-trading-day evidence windows start after that, so the first honest `signals_only` candidacy for GBPUSD is late September 2026 at the earliest.

I will report Wave 1 as operationally complete only when every instrument has a documented, evidence-based disposition — not when the code exists.
