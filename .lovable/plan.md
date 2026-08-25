# Wave 1 — Instrument Expansion and Intelligence Foundation

## What the audit of HEAD actually found

Verified by reading code and querying the live database:

- The instrument list exists in **three** places that must be changed together:
  `src/lib/scanner/types.ts` (`INSTRUMENTS`, the scan authority),
  `src/lib/db-types.ts` (`ALL_INSTRUMENTS`, the settings UI list), and
  `src/lib/risk.ts` (`CONTRACT_SPECS`). Only XAUUSD, GBPAUD and EURUSD are present
  in all three.
- Adding an instrument to the scanner **without** a contract spec does not crash —
  sizing returns the explicit `no_spec` refusal, so the setup publishes but cannot
  be sized or executed. That is safe but user-hostile, so specs land in the same
  change as the instrument.
- `SPREAD_FLOOR` has three entries plus `DEFAULT_SPREAD_FLOOR = 0.0002`. That
  default is wrong for JPY pairs (2 pips on a 3-decimal pair is 0.02, not 0.0002),
  so per-instrument floors are required, not optional.
- Scan work is queued **per instrument**, not per timeframe: `enqueueScanCycle`
  inserts one job per instrument and each job fetches all three timeframes.
  Measured over the last 12 hours: average job 2.7-7.9s, worst observed 15.2s.
  The worker runs 3 jobs per pass with a 20s budget and up to 8 self-chained hops,
  so 8 instruments (~40-60s of work) drains in 3-4 hops with headroom. No queue
  redesign is needed for Wave 1.
- There is **no per-instrument lifecycle** today. `instrument_health` only records
  broker availability. Publication is all-or-nothing; execution gating is global
  (`demo_auto`) plus the intelligence gate.
- There is **no economic-calendar or news integration anywhere** in `src/`. News
  awareness is new build, not a fix.
- FX conversion is already sufficient: `FX_MAJORS` covers every leg the new pairs
  need, and `planConversion` handles direct, inverse and USD-cross routes with
  explicit `unsupported`/`no_conversion_rate` refusals.
- Portfolio exposure (`src/lib/sizing/portfolio.ts`) groups by **base currency
  only** and is advisory. Correlated USD exposure across five new USD pairs is
  therefore currently invisible.
- No database check constraint pins instrument names, so per-user instrument
  arrays accept new symbols with no migration.

## Scope decision

Wave 1 is split so the risky parts never ship with the cheap parts. Each stage is
independently shippable and reversible.

## Stage 1 — Instrument lifecycle (ships first, changes nothing user-visible)

Add an `instrument_lifecycle` table: one row per canonical instrument with a stage
of `data_validation`, `shadow`, `signals_only` or `execution_approved`, plus the
reason and who moved it. Stage changes are service-role only.

Wire the stage into exactly three read points:

- publication in the scan pipeline — below `signals_only`, the structure is written
  as a research observation only, never to `scanned_signals`;
- eligibility (`src/lib/delivery/eligibility.ts`) — feed and alerts require
  `signals_only`;
- enqueue (`src/lib/delivery/direct-enqueue.server.ts`) — automatic orders require
  `execution_approved`, refused with a named decision reason that appears in the
  existing decisions ledger.

The three existing instruments are seeded at their current effective stage
(`execution_approved`) so behaviour is byte-identical on deploy.

## Stage 2 — The five new instruments, in `data_validation`

Add GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF to `INSTRUMENTS`, `ALL_INSTRUMENTS`,
`CONTRACT_SPECS` and `SPREAD_FLOOR`, each seeded at `data_validation`. They are
scanned and measured; they publish nothing and execute nothing.

Correctness work this forces:

- JPY digit handling: verify that stop construction, spread floor, and every price
  the UI renders round by the instrument's own digits rather than a shared default.
  Broker `point`/`digits` from `broker_symbol_specs` is the authority; the static
  spec is the fallback.
- Include the new symbols in the daily spec-refresh budget and in the quotes route.
- Extend the FX pre-resolution set so each new quote currency (JPY, CAD, CHF) has a
  route to every supported account currency.

Promotion out of `data_validation` is a deliberate, evidence-backed decision using
the existing sufficiency gate (`src/lib/stats/evidence.ts`) — never automatic.

## Stage 3 — News awareness and blackout windows

A `news_events` table (instrument-affecting currency, impact, scheduled time,
source, revision history) filled by a scheduled fetch from one structured calendar
provider behind a secret. Point-in-time honest: an event row is stored with the
time it was *known*, so research can never see a schedule it could not have had.

Two consumers:

- publication marks a setup as inside a high-impact window rather than hiding it;
- automatic-order enqueue refuses inside the window, with the event named in the
  decision reason.

If the provider is unavailable, the window state is `unknown` and the enqueue path
fails **closed** (refuses). The feed keeps publishing, labelled.

## Stage 4 — Portfolio currency exposure

Extend the advisory exposure module to aggregate by both base and quote currency,
so five USD pairs plus gold show as one USD concentration. Wave 1 keeps this
advisory and labelled as derived from logged trades, not broker state — matching
the existing honesty rule. Turning it into a hard enqueue refusal is a separate
decision after we can see real numbers.

## Stage 5 — Predictive research challenger

A research-plane-only model that outputs a calibrated fill probability and an
expected R per candidate, written as `model_version = 3` research observations
with `signal_id = NULL`. It never writes `scanned_signals` and never influences
publication, alerts or execution in Wave 1. Reported in the admin terminal with
its calibration and sample size, gated by the existing evidence levels.

## Technical notes

- New tables follow the project pattern: create, then grants, then RLS enable,
  then policies. `instrument_lifecycle` and `news_events` are readable by
  authenticated users (they explain refusals) and writable by service role only.
- No seed rows, fixtures or demo generators for signals, market context or trades.
  The zero-hallucination rule is unchanged.
- Docs updated in the same change: `SCANNER.md` (instrument list is contract-tested
  against the code constants), a new lifecycle section in `ARCHITECTURE.md`, plus
  `RISK-SIZING.md` for JPY digits and the news document.
- Tests: lifecycle gating at all three read points, JPY spread-floor and digit
  maths, fail-closed news behaviour, quote/base exposure aggregation, and the docs
  contract for the expanded instrument list.

## What this plan does not claim

That the five new instruments will be promoted. Wave 1 buys the machinery and the
measurements; promotion is a later, evidence-gated decision per instrument.
