# Phase A — Data and Architecture Foundation (detailed plan)

Umbrella direction approved separately. Phase A is plan-only until approved here.
Phase A adds no intelligence, no news provider, no prediction model, and does not
make any new instrument visible or executable. Phase B is planned separately.

## Phase A objective

Give the system one authoritative instrument definition layer, an operational
lifecycle with immutable history, and the correctness work that a JPY/CAD/CHF pair
forces — then admit the five Wave 1 pairs at a stage where they can only be
measured. Existing XAUUSD, GBPAUD and EURUSD behaviour must be provably unchanged.

Explicitly out of scope for Phase A: news, predictions, promotion of any pair,
research cohort activation for the new pairs (Phase B), exposure extensions.

## A1 — Instrument registry (code only, zero behaviour change)

New `src/lib/instruments/registry.ts`, the single definition authority:

```
InstrumentDefinition = {
  symbol, label, base, quote,
  contractSize, lotStep, minLot,
  fallbackDigits,            // used only when no broker spec exists
  spreadFloor,               // V1-frozen for wave 0; broker-derived for wave 1
  wave: 0 | 1,
}
```

- `WAVE0 = XAUUSD, GBPAUD, EURUSD` with values copied byte-for-byte from
  `CONTRACT_SPECS` and `SPREAD_FLOOR` in `src/lib/risk.ts`, plus
  `INSTRUMENT_LABELS` in `src/lib/db-types.ts`.
- Wave 1 definitions are added in A4, not here.
- Broker-authoritative facts are NOT copied in: `digits`, `point`, `stops_level`,
  `volume_*`, `trade_mode` continue to come from `broker_symbol_specs` and
  `connected_account_specs`, and per-account symbol names from
  `connected_account_symbols`.

Existing constants become thin re-exports so nothing else changes shape:
`INSTRUMENTS` (`src/lib/scanner/types.ts`), `ALL_INSTRUMENTS` and
`INSTRUMENT_LABELS` (`src/lib/db-types.ts`), `CONTRACT_SPECS` and `SPREAD_FLOOR`
(`src/lib/risk.ts`).

Tests: a registry-parity test asserting the derived constants are deeply equal to
the current literals (the literals are copied into the test as frozen expectations),
so A1 cannot alter a single number.

## A2 — Lifecycle schema

Migration A2 (single migration, additive only):

```
create type instrument_stage as enum
  ('disabled','data_validation','shadow','signals_only','execution_approved','suspended');

instrument_lifecycle
  symbol text primary key
  stage instrument_stage not null default 'disabled'
  wave smallint not null default 1
  data_health text                -- last operational verdict
  updated_at timestamptz not null default now()

instrument_lifecycle_transitions   -- append-only, no update/delete policy
  id bigserial primary key
  symbol text not null references instrument_lifecycle(symbol)
  from_stage instrument_stage
  to_stage instrument_stage not null
  reason text not null
  evidence jsonb                  -- gate snapshot at decision time
  strategy_model_version smallint
  code_hash text
  approver text
  rollback_target instrument_stage
  created_at timestamptz not null default now()
```

Grants and RLS, in the required order: grants → enable RLS → policies.

- `instrument_lifecycle`: `GRANT SELECT` to `authenticated` is **not** given.
  Customers read a restricted projection instead:
  `public.instrument_stages` view exposing `symbol, stage` only, granted
  `SELECT` to `authenticated`. Approver, reason, evidence and notes stay
  service-role.
- `instrument_lifecycle_transitions`: `GRANT ALL` to `service_role` only; no
  authenticated grant; a policy set with no UPDATE/DELETE policy, making history
  append-only in practice.
- `touch_updated_at` trigger on `instrument_lifecycle`.

Seed (data statement, run after the migration): the three Wave 0 symbols at
`execution_approved`, each with one transition row recording
`reason = 'wave 0 baseline, current effective stage'`.

## A3 — Lifecycle reads behind a flag, with parity proof

New `src/lib/instruments/lifecycle.server.ts`:

- `readStages(db)` → `Record<symbol, stage>`, short-cached per request.
- `LIFECYCLE_ENFORCED` flag read from `execution_controls` (new boolean column
  `lifecycle_enforced default false`, migration A3) so the switch is operational,
  not a redeploy.
- Read-failure policy, tested explicitly: for a Wave 0 symbol fall back to the
  frozen registry stage (`execution_approved`); for any symbol not in Wave 0 the
  answer is `disabled`. Never "unknown means allowed".

Call sites — each gets one added check, no rule duplicated:

| Path | File | Requirement when enforced |
| --- | --- | --- |
| publication | `src/lib/scanner/pipeline.server.ts` | `>= signals_only` to write `scanned_signals`; below it the job records the observation and returns a named skip |
| feed/alerts | `src/lib/delivery/eligibility.ts` | `>= signals_only` |
| auto enqueue | `src/lib/delivery/direct-enqueue.server.ts` | `= execution_approved`, refusal reason `instrument_not_approved` in `execution_enqueue_decisions` |
| final pre-send | `src/lib/delivery/revalidate.server.ts` | `= execution_approved` re-checked immediately before submission; otherwise delivery ends `rejected` with reason `instrument_not_approved` (existing terminal path) |
| direct submit | `src/lib/execution/direct.server.ts` | inherits the revalidate gate; no second rule |

`suspended` behaves as "not approved" everywhere, so a demotion after enqueue is
refused at the pre-send gate. `disabled` additionally skips scanning.

Parity requirement before A3 enforcement is switched on: with the flag off, and
again with the flag on for Wave 0 only, the same recorded inputs must produce
identical direction, grade, entry, stop, TP1-3, R multiples, structure key,
confidence, pillars, gate outcomes, publication decision, alert decision,
eligibility verdict, sizing result, enqueue decision and final pre-send verdict.

## A4 — Wave 1 pairs admitted at `data_validation`

Registry additions: GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF (`wave: 1`).
Lifecycle rows inserted at `disabled`, then moved to `data_validation` only after
A5 passes for that symbol. Publication, alerts and execution remain impossible by
construction at both stages.

Derived coverage this unlocks automatically (all already read `INSTRUMENTS`):
`src/lib/broker/specs.server.ts` (daily spec refresh),
`src/routes/api/public/quotes.ts`, `src/lib/sizing/conversion.server.ts`,
`src/lib/accounts/provision.server.ts` (symbol mapping on connect).

`scanner_settings.instruments` column default and the `settings.tsx` initial
selection are pinned to Wave 0 (migration A4 alters the column default to the same
literal it already has, expressed against the registry in code). Eligibility is
changed so an instrument outside Wave 0 requires explicit inclusion — an empty
`instruments` array continues to mean "all Wave 0", never "all instruments".
Current data makes this safe: 5 settings rows, 0 empty arrays, all with exactly the
three Wave 0 symbols.

## A5 — Precision, cost floor and conversion correctness

Per-symbol operational readiness check (`src/lib/instruments/readiness.server.ts`),
run on demand and recorded into `instrument_lifecycle.data_health`:

1. symbol maps unambiguously on the benchmark account (existing `symbol-map.ts`
   verdicts: `exact`/`suffix` pass; `ambiguous`/`unavailable` fail);
2. `broker_symbol_specs` row present, fresh, with `digits` and `point`;
3. candle completeness per timeframe at the configured depth;
4. quote freshness within the existing bound;
5. conversion route resolvable from the symbol's quote currency to every supported
   account currency (USD, EUR, GBP, AUD) via existing `planConversion`;
6. no unresolved data-integrity failure in `instrument_health`.

Spread floor: for Wave 1 the floor is **derived**, never guessed —
`max(point × measured_spread_points_p90, stops_level × point)` from the broker's
own spec, recorded with its source. Until a measurement exists the readiness check
fails and the symbol stays at `disabled`. Wave 0's three literals stay frozen for
V1 characterisation, and `DEFAULT_SPREAD_FLOOR` is retained only as the
last-resort fallback it already is, with a test proving no registry symbol relies
on it.

## A6 — Failure isolation

Migration A6, additive:

- `instrument_health` gains `consecutive_failures int not null default 0`,
  `failure_scope text` (`market_data` | `spec` | `research`), and
  `breaker_open_until timestamptz`.
- Per-instrument breaker in the scan path: repeated failures skip that symbol for a
  cooling window; the cycle and all other symbols proceed. Existing behaviour
  (skip-and-flag) is preserved, only counted per symbol now.
- Research failure counters move from global-only to per-instrument: the existing
  global `shadow_engine_state.research_errors` is retained for provider-wide
  failure, and a new per-symbol counter prevents one new pair from tripping the
  global pause that today would stall Gold research.

## Migration-by-migration map

| # | Contents | Reversible by |
| --- | --- | --- |
| A2 | enum, `instrument_lifecycle`, `instrument_lifecycle_transitions`, grants, RLS, policies, `instrument_stages` view, touch trigger | dropping the objects; nothing else reads them until A3 |
| A3 | `execution_controls.lifecycle_enforced boolean default false` | set false |
| A4 | `scanner_settings.instruments` default pinned to the Wave 0 literal | restore prior default (identical value) |
| A6 | `instrument_health` failure/breaker columns | columns unused when the flag is off |

Data statements (run_sql, not migrations): Wave 0 seed rows and their transition
records; per-symbol stage moves.

No migration rewrites, deletes or relabels an existing row. No instrument column has
a check constraint, so no existing data is touched by expansion.

## File-by-file implementation map

Additive: `src/lib/instruments/registry.ts`,
`src/lib/instruments/lifecycle.server.ts`,
`src/lib/instruments/readiness.server.ts`, plus tests under
`src/lib/instruments/__tests__/`.

Edited (one concern each): `src/lib/scanner/types.ts`, `src/lib/db-types.ts`,
`src/lib/risk.ts` (re-exports); `src/lib/scanner/pipeline.server.ts` (publication
gate, per-symbol breaker); `src/lib/delivery/eligibility.ts` (stage + explicit
opt-in); `src/lib/delivery/direct-enqueue.server.ts` (refusal reason);
`src/lib/delivery/revalidate.server.ts` (pre-send stage re-check);
`src/lib/queries.ts` (stage projection for the UI);
`src/routes/_authenticated/settings.tsx` (Wave 0 default selection);
`src/lib/mcp/settings-validation.ts` (accepts only registry symbols);
`docs/SCANNER.md`, `docs/ARCHITECTURE.md`, `docs/RISK-SIZING.md`,
`docs/OPERATIONS.md` (lifecycle, registry, derived floors, runbook).

Untouched by Phase A: grading, indicators, profile, V2/V3 modules, journal, R math,
statistics, evidence gate, exposure modules, MetaApi request layer.

## Test matrix

Parity (blocking): frozen-input snapshots for the three Wave 0 pairs across every
field listed in A3, run with the flag off and on.
Registry: derived constants deeply equal today's literals; every registry symbol has
a spread floor; no symbol falls through to `DEFAULT_SPREAD_FLOOR`.
Precision: USDJPY digits/point maths, floor derivation from broker spec, and a
regression proving Wave 0 floors are unchanged.
Conversion: every Wave 1 quote currency to each of USD/EUR/GBP/AUD, plus the
`unsupported` and `no_conversion_rate` refusals.
Symbol mapping: ambiguous and unavailable broker symbols refuse.
Lifecycle: each stage's effect at all five call sites; read-failure fallback for
Wave 0 and for Wave 1; queued delivery refused after demotion or suspension;
append-only history (an update/delete attempt is rejected).
Opt-in: empty `instruments` array never yields a Wave 1 instrument on feed, toast,
push, email, webhook, MCP or auto execution.
Isolation: repeated USDJPY failures do not raise the global research counter, do not
pause Gold research, and do not stall the queue.
Docs contract: `src/test/__tests__/docs-contract.test.ts` continues to pin the
documented instrument list to the code constants, now sourced from the registry.

## Deployment sequence

1. Apply A2; verify rows, grants, RLS and that the projection returns stage only.
2. Seed Wave 0 at `execution_approved` with transition rows; verify counts.
3. Deploy A1/A3 code with `lifecycle_enforced = false`; run dual-path comparison in
   the test suite and observe production output unchanged for one full scan cycle.
4. Set `lifecycle_enforced = true` (Wave 0 only exists at this point); observe one
   further cycle plus one alert and one enqueue decision.
5. Apply A4/A6; add the five pairs at `disabled`.
6. Run readiness per symbol; move each passing symbol to `data_validation`
   individually, never as a batch.

## Rollback sequence

Per step, in reverse: demote a symbol to `disabled`; set
`lifecycle_enforced = false` (system returns to today's behaviour with the tables
inert); revert the code deploy; drop the A2 objects if the direction is abandoned.
No step requires restoring data, because no data is modified.

## Monitoring and acceptance criteria

Per stage: zero parity diffs; queue age p95 under 5 minutes; cycle completion under
5 minutes; per-instrument provider error rate under 5%; stale-job rate zero; candle
completeness at or above 99% per Wave 1 symbol; no change in Wave 0 signal volume
attributable to the deploy. Rollback trigger: any two criteria breached for two
consecutive hours, or any Wave 0 parity diff at all.

## Customer protection during Phase A

Scanner, alerts, monitoring, automatic trading, watchlists, execution settings,
statistics, model priors, mobile and desktop UI, MCP behaviour and support
diagnostics are unchanged: the only enforced stage in Phase A is
`execution_approved` for the three pairs that already have it. New pairs are
invisible in the feed, absent from alerts, unselectable in settings, and refused at
the pre-send gate. Degradation is explicit for lifecycle read failure (fall back to
frozen Wave 0), missing spec, stale quote, broker symbol failure and single-symbol
provider failure.

## Completion evidence for Phase A

Parity snapshots green; lifecycle tests green; five symbols present at
`data_validation` with a recorded readiness verdict each; a demotion drill showing a
queued delivery refused; documentation updated; and one full scan cycle logged with
Wave 0 output identical to the pre-deploy cycle.

## Decisions still open (they belong to Phase B, not A)

News policy and provider; the geometry cohort used for suppressed-pair research;
whether users must opt in per pair at `signals_only`; predictive challenger scope.
Phase A is deliberately independent of all four.
