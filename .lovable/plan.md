# Phase A2 — Revised Plan (A2A / A2B / A2C) after independent re-audit

## 1. Executive feasibility verdict

Phase A2 is feasible, but **Phase A1 is not clean**. Four of your nine findings are confirmed as real defects with code and database evidence, three are confirmed as designed-but-unfinished, two are partially wrong in detail but right in substance, and one blocker you did not list is confirmed: `bun run verify` is **red at HEAD** because `bun run lint` fails. Recommendation: **approve A2A only after the A1-R remediation package below is executed as part of A2A stage 0**. A2B and A2C stay unapproved.

## 2. Repository HEAD and deployed migration state

- Reviewed commit `e553811` is **no longer HEAD**. `git rev-parse HEAD` = `92d88bc2a968c353d6beb2c9ddc7921fc51cf9a8` (`92d88bc Update plan` → `3ea2c2f Changes` → `e553811 Ran migration for Phase A1`). Only plan/formatting commits sit on top; the audited code is unchanged.
- Latest deployed migrations: `20260825082437` (lifecycle tables, `instrument_stages` view, `execution_controls.lifecycle_enforced`, `instrument_health` breaker columns), `20260825082457`, `20260825093932` (`transition_instrument_stage`), `20260825094206`.

## 3. Live flags and lifecycle state

`instrument_lifecycle`: XAUUSD / GBPAUD / EURUSD = `execution_approved` (wave 0); AUDUSD, GBPUSD, USDCAD, USDCHF, USDJPY = `disabled` (wave 1).
`execution_controls`: `lifecycle_enforced = false`, `live_execution_enabled = false`.
`scanned_signals` for non-Wave-0 instruments: **0**. `research_candidates`: **0**. `shadow_executions`: **484**.

## 4. Reproducible build/test evidence

| Command | Result |
| --- | --- |
| `bun run lint` | **FAIL** — 55 problems (33 errors, 22 warnings), all `prettier/prettier` formatting in Phase A1 files (`lifecycle.ts`, `lifecycle.server.ts`, `mapping.server.ts`, `readiness.server.ts`, `series.ts`, `observations.server.ts`, and the two new tests) plus pre-existing component warnings |
| `bun run typecheck` (`tsc --noEmit`) | PASS, no diagnostics |
| `bun run test` (`vitest --project blocking`) | PASS — 87 files, **1088 tests passed, 0 failed, 0 skipped**, 8.53 s |
| `bun run build` | PASS (harness build log: `build OK`) |
| `bun run test:report` (`--project report`, `[INTENDED_V2]`) | non-blocking, not part of the gate |

So the earlier "1088 tests pass" claim reproduces, but the claim that the repository is green does not: `verify` fails at its first step.

## 5. Finding-by-finding A1-R verdict

| Finding | Verdict | Evidence |
| --- | --- | --- |
| **A1-R1** structure-key break | **CONFIRMED, highest severity** | Live active Gold keys carry 5 decimals: `XAUUSD\|long\|2026-08-24T22:00:00.000Z\|2026-08-25T00:30:00.000Z\|4649.93597`. `structureKeyOf` (`src/lib/scanner/profile.ts:621-629`) now renders `priceDecimals("XAUUSD")` = 2 → `4649.94`. `scanned_signals_active_structure` is unique on `structure_key` where `status='active'`, so the new key does not collide with the old one; the code-side duplicate check is `.eq("n", profile.structureKey)`. Every one of the 56 XAUUSD rows becomes invisible to duplicate detection. Key lengths already differ per instrument (XAUUSD 72–73 vs 69–70 chars) |
| **A1-R2** tick normalization not integrated | **CONFIRMED** | `rg normalizeToTick src --glob '!*__tests__*'` returns only its own definition in `precision.ts`. Zero production call sites. `entryPriceKey` and `roundPrice` likewise have zero call sites; only `priceDecimals` is used, and only by `structureKeyOf` |
| **A1-R2b** rounding-label maths | **CONFIRMED** | `normalizeToTick` uses the identical branch for `safer_stop` and `safer_limit` (`precision.ts:122-128`): long → `down()`, short → `up()`. That is wrong for take-profits and conflates monetary risk with structural clearance |
| **A1-R3** lifecycle not re-read at submission | **CONFIRMED** | `revalidate.server.ts:207` reads the view once; the gate runs at `:340`; TIF, eligibility, quote, account, spec and sizing all follow; `dispatch.server.ts` calls `revalidateDelivery` (`:136`) then `submitDirectOrder` (`:161`) with **no** lifecycle import or re-read |
| **A1-R3b** degraded read fails open | **CONFIRMED** | `readLifecycleView` sets `enforced: false` whenever either read fails; every gate is wrapped in `if (lifecycle.enforced)`, so an unreadable lifecycle table disables the Wave 1 gate entirely rather than only preserving Wave 0 |
| **A1-R4** caller-supplied recovery target | **CONFIRMED** | migration `20260825093932:158-160`: `ELSIF _current = 'suspended' THEN _allowed := _rollback_target IS NOT NULL AND _to = _rollback_target;`. A caller passing `_to = _rollback_target = 'execution_approved'` recovers straight to execution regardless of the pre-suspension stage |
| **A1-R5** conversion is topology only | **CONFIRMED** | `readiness.server.ts:250-269` calls `planConversion(definition.quote, accountCurrency)` and records `ok: plan.kind !== "unsupported"`. No conversion quote is fetched, so no freshness, geometry or inversion check exists |
| **A1-R6** stale stage for research | **CONFIRMED with nuance** | `pipeline.server.ts` reads the view once at `:285` and reuses `instrumentStage` for capture (`:370`) and strategy (`:506`); only publication re-reads (`:614`). So V2/V3 enrolment and shadow creation can run on a stage that changed mid-job |
| **A1-R7** current-candle policy | **CONFIRMED** | `series.ts:161-183` detects `incomplete_current_candle` and explicitly excludes it from `fatal`. `fetchCandles` (`metaapi/market.server.ts:72`) trims nothing, so V1 grades a forming bar. No policy is versioned anywhere |
| **A1-R8** mapping still spec-derived, and unused | **CONFIRMED, worse than stated** | `resolveScannerScope` proves the name from a `broker_symbol_specs` row (name-existence only, documented as such). Worse: readiness resolves `mapping.providerSymbol` and then fetches with the canonical `symbol` (`readiness.server.ts:167`, `:204`), so the symbol verified is not the symbol used |
| **A1-R9** evidence not reproducible / parity relaxed | **CONFIRMED** | Section 4 above. And `characterization-pre-p7.test.ts:109-131` was rewritten to assert the key "differs from the frozen key ONLY by instrument precision" — the expectation was changed to match new behaviour, which is a behavioural change, not parity |

## 6. Corrections to this prompt

1. HEAD is `92d88bc`, not `e553811`.
2. `shadow_executions` = 484 rows, not 482.
3. A1-R2 is broader than stated: `entryPriceKey` and `roundPrice` are also dead code, so no display path is normalized either.
4. A1-R8 has a second, sharper defect (verified symbol ≠ fetched symbol) that the prompt only hints at.
5. Unlisted blocker: lint fails, so `verify` is red; that must be fixed before any A2A claim of green CI.
6. Validation order is kept as given, on this reasoning: GBPUSD/AUDUSD are USD-quoted (no quote-currency conversion for a USD account), USDCHF/USDCAD need one leg, USDJPY is last because it is the only 3-digit tick grid. No evidence supports reordering.

## 7. Remaining A1 remediation packages (A2A stage 0, blocking)

- **R1-FIX** `src/lib/scanner/profile.ts`: revert identity rendering to a fixed 5-decimal `stopKey`, introduced as `STRUCTURE_KEY_V1` in `src/lib/scanner/structure-key.ts`. Identity stops depending on display precision.
- **R2-FIX** `src/lib/instruments/precision.ts` + `src/lib/delivery/revalidate.server.ts` + `src/lib/execution/direct.server.ts`: order-role normalization, applied at the submission boundary, with post-normalization re-derivation.
- **R3-FIX** `revalidate.server.ts`, `dispatch.server.ts`, `direct.server.ts`: final-boundary lifecycle recheck; `lifecycle.server.ts`: degraded reads fail closed for non-Wave-0.
- **R4-FIX** new migration replacing `transition_instrument_stage` body; adds `instrument_lifecycle.pre_suspension_stage`.
- **R5-FIX** `readiness.server.ts` split into route readiness and live conversion-data readiness.
- **R6-FIX** `pipeline.server.ts` recheck before each persistent write.
- **R7-FIX** `src/lib/scanner/candle-policy.ts` + provenance stamping.
- **R8-FIX** `mapping.server.ts` + all fetch call sites use `providerSymbol`.
- **R9-FIX** `bunx prettier --write` on the flagged files; restore the strict frozen-key assertion in `characterization-pre-p7.test.ts`.

## 8. Wave 0 compatibility strategy

Wave 0 behaviour is defined as: identical structure keys, identical graded profiles, identical publication/duplicate decisions, identical alert eligibility, identical sizing, identical spread floors. Enforced by the restored strict characterization test plus a new golden test that replays the 122 live Wave 0 structure keys through `structureKeyOf` and asserts byte equality.

## 9. Structure-key compatibility design

Options considered: (a) keep legacy 5-decimal identity for all instruments; (b) versioned key with dual lookup; (c) migrate reconstructable active keys; (d) formatting-independent identity.

**Chosen: (a) + (d).** Identity becomes `instrument|direction|aTime|bTime|<stop rendered at fixed 5 decimals>` in a dedicated module, with a `structure_key_version` constant of `1` recorded in provenance. This is byte-identical to every one of the 122 live keys, so no active signal ever becomes invisible to duplicate detection, and it removes the coupling to broker digits that caused the defect. (b) is rejected as unnecessary complexity once identity no longer depends on digits; (c) is rejected because it rewrites live rows for no benefit. Display precision (`roundPrice`) may still be instrument-aware — it just cannot feed identity.

## 10. Broker-price normalization design

Replace `TickRounding` with explicit roles:

| Role | Long | Short | Rationale |
| --- | --- | --- | --- |
| `entry_limit` | down | up | harder to fill, never a worse fill than shown |
| `stop_loss` | down | up | preserves structural clearance; risk then **re-derived** |
| `take_profit` | up | down | harder to fill, never an optimistic target |

Submission sequence in `revalidate.server.ts` / `direct.server.ts`: resolve destination account mapping → load that account's live spec → normalize all three prices by role → **reject** (`no_execution_grid`) if no `tickSize`/`point` → recompute risk-per-unit, stops-level check, max-acceptable-entry check, quantity, margin and risk ceilings from the normalized prices → persist both original and submitted geometry on `execution_deliveries` for reconciliation.

## 11. Lifecycle recheck map by action boundary

| Boundary | Recheck | Fail-closed for Wave 1 when degraded |
| --- | --- | --- |
| scan universe | once per cron pass | yes |
| candle/quote fetch | reuse pass value | yes |
| V1/V2/V3 evaluation (pure) | reuse pass value | yes |
| observation write | re-read | yes |
| candidate capture | re-read | yes |
| shadow enrolment | re-read | yes |
| resolver enrolment | re-read | yes |
| publication | re-read (exists) | yes |
| alert fan-out | re-read | yes |
| execution enqueue | re-read | yes |
| revalidation approve | re-read | yes |
| broker submission | re-read immediately before POST | yes |

Rule: pure calculation may reuse a pass-level read; every persistent or externally visible action re-reads. `readLifecycleView` gains `waveOf(symbol)` awareness so a degraded read yields "Wave 0 unchanged, everything else refused" rather than "enforcement off".

## 12. Suspension and recovery state machine

`instrument_lifecycle.pre_suspension_stage instrument_stage NULL`. The RPC sets it when moving to `suspended` (only if currently NULL, so repeated suspensions keep the first authority) and clears it on recovery. Recovery is allowed only to the persisted value; `_rollback_target` from the caller becomes advisory metadata written to history and is never consulted for authorization. Emergency `disabled` is distinct: it clears `pre_suspension_stage` and forces the full ladder again. Concurrency is unchanged — the RPC already takes `FOR UPDATE` on the lifecycle row.

## 13. Mapping and provider-symbol authority

Scanner scope stays "exact canonical symbols only", documented as a limitation, and fails closed on aliases; A2A adds no provider symbol-inventory call. `resolveMapping` returns `providerSymbol`, and readiness, candle fetches, quote fetches and spread sampling all pass that value to `fetchCandlesFor`/`fetchQuoteFor`. A readiness report may not be `ready` unless the symbol it verified is the symbol it fetched — asserted by test.

## 14. Conversion-data readiness matrix

Two separate checks: `conversion_route` (topology, today's `planConversion`) and `conversion_data` (a live quote per leg: present, parseable, geometrically valid, source-timestamp fresh, not future-dated, correctly inverted, and identical to what the sizing service would use). Matrix per account currency (USD, EUR, GBP, AUD) x route kind (parity, direct, inverse, usd_cross) x failure mode (missing, invalid, stale, future, unparseable, unsupported, missing provider symbol). `ready` requires both.

## 15. Candle finality and snapshot policy

`src/lib/scanner/candle-policy.ts` defines `CANDLE_FINALITY_POLICY`:
- `v1_includes_forming` — current live V1 behaviour, unchanged, stamped on every V1 row. Documented consequences: intrabar repainting, non-reproducible replay, detection-time features that differ from candle-close features, live/backtest divergence.
- `v2_closed_only` — closed candles only, used by new Wave 1 research cohorts.
Every observation and candidate stores the policy id plus per-timeframe candle as-of (max closed candle timestamp). Wave 0 is not silently changed.

## 16. Exact raw spread-sample schema

`public.instrument_spread_samples` — writer: sampler worker (service role); reader: aggregate job + admin RPC.
`id bigserial PK`, `run_id uuid NOT NULL REFERENCES spread_sampler_runs(run_id)`, `instrument text NOT NULL`, `provider_symbol text NOT NULL`, `scope text NOT NULL DEFAULT 'scanner'` (no ids/logins), `stage instrument_stage NOT NULL`, `bid numeric(20,10) NULL`, `ask numeric(20,10) NULL`, `mid numeric(20,10) NULL`, `spread_price numeric(20,10) NULL`, `spread_points numeric(20,6) NULL`, `spread_pips numeric(20,6) NULL`, `digits smallint NULL`, `point numeric(20,10) NULL`, `tick_size numeric(20,10) NULL`, `atr_snapshot_id bigint NULL REFERENCES instrument_atr_snapshots(id)`, `spread_atr_fraction numeric(12,8) NULL`, `session text NULL`, `session_version smallint NOT NULL`, `source_time timestamptz NULL`, `received_at timestamptz NOT NULL DEFAULT now()`, `mapping_verified_at timestamptz NULL`, `spec_as_of timestamptz NULL`, `market_state text NOT NULL`, `quality text NOT NULL` (`valid|stale|future_dated|closed_market|malformed|inverted`), `quality_reasons text[] NOT NULL DEFAULT '{}'`, `sampler_version smallint NOT NULL`, `created_at timestamptz NOT NULL DEFAULT now()`.
Constraints: `CHECK (quality <> 'valid' OR (bid IS NOT NULL AND ask IS NOT NULL AND ask > bid AND source_time IS NOT NULL))`; `UNIQUE (instrument, scope, source_time, sampler_version)` (idempotency; NULL `source_time` rows are diagnostic and excluded by a partial unique index). Indexes: `(instrument, created_at DESC)`, partial `(instrument, session, source_time)` where `quality='valid'`. Grants: `GRANT SELECT, INSERT, DELETE ON ... TO service_role` only; RLS enabled, single service-role policy; no `anon`, no `authenticated`. View `instrument_spread_samples_valid` filters `quality='valid'` and is the only input to aggregates.

## 17. Exact sampler-attempt schema

`public.spread_sampler_runs` — `run_id uuid PK DEFAULT gen_random_uuid()`, `scheduled_at timestamptz NOT NULL`, `started_at timestamptz NOT NULL DEFAULT now()`, `finished_at timestamptz NULL`, `sampler_version smallint NOT NULL`, `expected_instruments text[] NOT NULL`, `attempted_instruments text[] NOT NULL DEFAULT '{}'`, `succeeded_instruments text[] NOT NULL DEFAULT '{}'`, `invalid_samples integer NOT NULL DEFAULT 0`, `failed_requests integer NOT NULL DEFAULT 0`, `stage_skipped text[] NOT NULL DEFAULT '{}'`, `breaker_skipped text[] NOT NULL DEFAULT '{}'`, `duplicate_source_times integer NOT NULL DEFAULT 0`, `provider_outage boolean NOT NULL DEFAULT false`, `timed_out boolean NOT NULL DEFAULT false`, `request_count integer NOT NULL DEFAULT 0`, `retry_count integer NOT NULL DEFAULT 0`, `duration_ms integer NULL`, `error_class text NULL`, `killed boolean NOT NULL DEFAULT false`. `UNIQUE (scheduled_at, sampler_version)` makes a retried cron tick idempotent. Service-role only, RLS on.

## 18. Exact aggregate schema and percentile method

`public.instrument_spread_stats` — key `(instrument, session, session_version, stage, trading_date, scope, computation_version)` as PK; columns: `raw_samples`, `valid_samples`, `excluded_samples`, `distinct_trading_days`, `session_coverage numeric(6,4)`, `missingness numeric(6,4)`, `p50/p75/p90/p95/p99/max_spread_price numeric(20,10)`, `p50/p90_spread_points numeric(20,6)`, `median_atr_fraction`, `p90_atr_fraction numeric(12,8)`, `coverage_start`, `coverage_end timestamptz`, `calculated_at timestamptz NOT NULL DEFAULT now()`. Percentile: **nearest-rank, inclusive** — sort valid samples ascending, index `ceil(p * n)`, 1-based, no interpolation; deterministic and pinned by test. Aggregates are recomputed, never mutated in place, and `computation_version` bumps on any formula change.

## 19. Exact missingness formula

`missingness = 1 - (valid_sample_slots / expected_slots)` where `expected_slots` counts sampler runs in the window whose `expected_instruments` contains the instrument, and a slot is "valid" when that run produced at least one `quality='valid'` row for it. Buckets reported separately: no scheduled attempt (run absent), scheduled-but-stage-skipped, scheduled-but-breaker-skipped, attempted-but-request-failed, quote-returned-but-invalid, valid, duplicate provider timestamp. Only the first bucket is excluded from the denominator; stage- and breaker-skips are reported and excluded, request failures and invalid quotes are counted as missing.

## 20. ATR provenance and caching design

Never fetch M15 history from a sampling run. `public.instrument_atr_snapshots` — `id bigserial PK`, `instrument`, `timeframe`, `atr numeric(20,10)`, `atr_period smallint`, `atr_version smallint`, `candle_as_of timestamptz`, `created_at`. Written by the existing scan worker, which already computes M15 ATR. The sampler joins the newest snapshot whose `candle_as_of` is within one M15 interval; otherwise `spread_atr_fraction = NULL`.

## 21. Retention and storage calculation

Rows/day at 8 instruments x 15-minute cadence x 24 h = 768/day worst case (Wave 1 only in `data_validation`/`shadow`: 5 x 96 = 480/day). At ~250 bytes/row plus index overhead: ~0.2 MB/day, ~12 MB at 60 days. That comfortably supports the proposed **60-day** raw retention; aggregates (a few hundred rows/day at most) are kept indefinitely. Retention worker: `cron/retention-spread`, bounded `DELETE ... WHERE created_at < now() - interval '60 days'` in 5 000-row batches with a per-run cap, run-id idempotency, deleted-count metrics, and no shared budget with the scanner. It may delete `instrument_spread_samples` and `spread_sampler_runs` only.

## 22. Candidate-to-shadow-execution contract

Eligibility: stage allows `capture_research` **at the moment of write**; the model's own enabled flag is true; the candidate is fresh; the instrument is not breaker-open. Then: `shadow_executions` gains `candidate_id bigint NULL REFERENCES research_candidates(id)`, `cohort text NOT NULL DEFAULT 'legacy_unstamped'`, `resolver_version smallint`, `candle_finality_policy text`. Plan snapshot (entry/stop/targets/direction/detected_at) is written once and immutable (existing immutability trigger extended). Idempotency: `UNIQUE (candidate_id, cohort, resolver_version)` plus the existing structure claim. Retries re-use the key; expiry follows the existing TIF; statistics include only `status='resolved'` rows with a non-ambiguous outcome, grouped by cohort. The existing 484 rows keep `cohort='legacy_unstamped'` and `candidate_id NULL`, are never rewritten, and are excluded from every Wave 1 cohort by that column.

## 23. Resolver state machine

States: `pending → never_filled | filled`; `filled → tp1 → tp2 → tp3`, `filled → stopped`, plus terminal `expired`, `cancelled_data_invalid`, `ambiguous_same_candle`, `suspended_missing_candle`, `provider_outage`, `unresolved_manual`. Rules: eligible fill starts at the candle strictly after detection; ordering by candle open time then sequence; entry/stop/target comparisons use the stored plan side (bid for long exits, ask for long entries) with the policy id recorded; a gap through entry fills at the gap open; a gap beyond stop resolves `stopped` at the gap price and is flagged; same-candle entry-and-exit is `ambiguous_same_candle`, never the profitable reading; a missing candle suspends rather than skips; late-arriving candles are reprocessed only forward of the stored cursor; every write is idempotent on `(id, replay_cursor)`; corrections require a `resolver_version` bump, never an in-place rewrite. Isolation: per-instrument batches, bounded pagination, retry cap, backlog age and oldest-unresolved metrics, breaker compatibility, kill switch.

## 24. Exact admin diagnostics schema/RPC

`public.instrument_readiness_snapshots` — `id bigserial PK`, `instrument`, `ready boolean`, `checks jsonb`, `mapping jsonb`, `spec_fields jsonb`, `series jsonb`, `conversion jsonb`, `spread_floor_candidate numeric(20,10)`, `code_hash`, `checked_at`. Service-role writes.
`public.get_admin_instrument_diagnostics()` — `SECURITY DEFINER`, `SET search_path = public`, first statement `IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' END IF`, returns `jsonb` with only the fields listed in your A2.6 list. `REVOKE EXECUTE ... FROM anon`; `GRANT EXECUTE ... TO authenticated` (admin check inside). Route: `src/routes/_authenticated/admin/instruments.tsx` + `src/components/admin/InstrumentDiagnosticsPanel.tsx`. No account ids, logins, tokens, raw payloads or stack traces are selected anywhere in the function body.

## 25. Security, grants and RLS

Every new table: RLS enabled, service-role-only policies, `GRANT` to `service_role` only, no `anon`, no `authenticated`. All admin reads go through the definer RPC. New tests: an `authenticated` non-admin caller gets `forbidden` from the RPC; `anon` cannot select any new table; the definer function has a fixed `search_path`; the diagnostics payload contains none of the forbidden fields (asserted by key-name scan).

## 26. Capacity metrics and proposed thresholds

`public.scanner_capacity_samples` stores per-cron-pass: job duration, cycle duration, queue age, stale jobs, timeouts, chain depth, provider requests/errors/throttles, candle/quote failures, DB write failures, alert and enqueue latency and failures, resolver throughput/backlog/oldest age, breaker events, Wave 0 publication/alert/execution counts. Distributions reported as p50/p95/p99; averages never used alone.

Absolute ceilings (proposed, to be re-derived from baseline where marked †): cycle p95 < 9 min and p99 < 12 min against the 15-min interval; queue age p95 < 5 min†; stale-job rate < 0.5 %†; provider error rate < 2 %†; timeout rate < 1 %†; quota headroom ≥ 40 %; resolver backlog slope ≤ 0 over 24 h; oldest unresolved < 48 h; sampler missingness < 20 % per session; ≥ 10 valid trading days (20 before any tail claim); every relevant session covered; zero systematic candle gaps; mapping ≤ 30 days old, spec ≤ 48 h; breaker openings < 1/instrument/day. Baseline-relative limits: no metric may deteriorate by more than 25 % against the Wave 0 baseline, and Wave 0 publication, alert and execution-decision rates may not change beyond their measured baseline noise band.

## 27. A2A implementation sequence

0. A1-R remediation (section 7), each with its own tests; restore strict parity; make `verify` green.
1. Migrations: samples, sampler runs, aggregates, ATR snapshots, capacity samples, readiness snapshots, `execution_control_changes`, shadow-execution cohort columns, `pre_suspension_stage`.
2. Sampler worker `src/routes/api/public/worker/spread-sample.ts` + `src/lib/telemetry/spread-sampler.server.ts`, dark (no schedule created).
3. Aggregate + retention workers, dark.
4. Provenance population and cohort labels in `observations.server.ts`, `candidates.server.ts`, `enrol-candidates.server.ts`.
5. Resolver isolation and metrics in `shadow_resolve.server.ts`.
6. Admin diagnostics RPC, route and panel.
7. Capacity collection wired into the existing scan/dispatch/resolver paths (write-only).
8. Kill switches and flags on `execution_controls`; audited control-change path.
9. Docs: `docs/SPREAD-TELEMETRY.md`, `docs/INSTRUMENT-LIFECYCLE.md` update, `docs/README.md` index, contract test.

## 28. A2A acceptance criteria

`verify` green with the strict parity test restored; live Gold keys byte-identical through the new identity function; `normalizeToTick` reachable from the submission path with re-derived risk; lifecycle re-read at every boundary in section 11; degraded reads refuse Wave 1; recovery target persisted; conversion-data checks implemented; provenance stamped; sampler idempotent and capped; RLS/definer tests pass; `lifecycle_enforced` still `false`; all Wave 1 rows still `disabled`; zero Wave 1 signals, alerts, MCP items, deliveries or broker requests (verified by query).

## 29. A2A rollback

Every migration is additive, so rollback is `DROP` of the new objects plus a revert commit; no existing column is altered except additive `NULL` columns on `shadow_executions` and `instrument_lifecycle`. Sampler and retention have kill switches, and no schedule is created in A2A, so the dark path can simply never run.

## 30. A2B operational sequence

Collect a real Wave 0 baseline first. Then: prove enforced universe == current Wave 0 universe from runtime output; test degraded reads; test suspension and rollback via the RPC; flip `lifecycle_enforced` through the audited control-change path (expected previous value, new value, reason, approver, commit, evidence, rollback target, recorded in `execution_control_changes`); observe at least one full trading week; compare Wave 0 against baseline; run the rollback drill.

## 31. A2B acceptance criteria

Universe identity proven from logs, not asserted; no Wave 0 metric outside its baseline band; zero Wave 1 side effects; rollback drill restores `false` within one cron interval; all Wave 1 rows still `disabled`.

## 32. A2B rollback

Set `lifecycle_enforced = false` through the same audited path; behaviour returns to today's code path exactly because every gate is conditioned on that flag.

## 33. A2C activation sequence

GBPUSD → `data_validation` via the RPC with its readiness evidence; verify data-only behaviour by query (no evaluation, no candidate, no signal, no alert, no MCP item, no delivery, no broker request); observe capacity; then the next instrument, one transition at a time, overlap allowed only if measured capacity supports it. `data_validation → shadow` only on a passing evidence package.

## 34. Per-instrument evidence package

Frozen JSON attached to the transition: mapping (status, provider symbol, verified-at, no ambiguity), spec freshness and fields, candle completeness per timeframe, quote freshness, conversion route **and** data readiness per account currency, spread distribution with distinct trading days, per-session coverage and missingness, provider errors, breaker events, scan cost, queue impact, storage impact, open defects, rollback test result, deployed commit and schema version, plus a stated uncertainty and limitations section. No profitability or execution-readiness claim.

## 35. Statistical limitations

Distinct trading days and session coverage — never row count — carry the evidence. Five correlated USD pairs are not five independent regimes and will not be pooled. Cohorts never mix instrument, stage, model version, session version, mapping/spec version, production vs research, published vs suppressed, strategy rejection vs operational suppression, filled vs unfilled, resolved vs unresolved, ambiguous, or legacy unstamped. No metric will be described as evidence of outperforming the market.

## 36. Test matrix

Every item on your required-test list, plus: live-Gold-key byte parity; identity independent of broker digits; role-based tick rounding for all six role/direction combinations; rejection when no grid exists; risk re-derivation after normalization; lifecycle recheck at each boundary in section 11; degraded-read fail-closed per wave; suspension recovery ignores caller rollback target; conversion-data matrix; candle-policy stamping; percentile determinism; missingness denominator buckets; sampler idempotency/caps/kill switch/stage rules; ATR snapshot join and NULL fallback; retention bounds; cohort separation including the 484 legacy rows; resolver state transitions incl. gaps, ambiguity, missing and late candles; per-instrument isolation; admin authorization and payload-field scan; enforcement no-op; Wave 1 prohibition on publication/alert/MCP/delivery/broker; Wave 0 golden parity; user-preference protection.

## 37. Observability and alerting

Admin diagnostics panel plus capacity samples are the operator surface. Alert conditions: sampler missingness above threshold, resolver backlog slope positive over 24 h, oldest unresolved age past ceiling, breaker repeatedly opening, provider error rate above ceiling, cycle p95 past ceiling, any Wave 1 side effect detected.

## 38. Stop conditions and residual risks

Stop immediately on any of your rollback conditions; additionally on any Gold duplicate publication, any off-grid submitted price, or any Wave 1 row appearing in `scanned_signals`. Residual risks: scanner scope cannot discover suffixed symbols (documented, fails closed); V1 still grades forming candles (versioned, not fixed, to preserve Wave 0); spread telemetry from the benchmark data account may not represent a customer's own broker; correlated USD pairs limit inference; provider quota remains a single shared budget.

## 39. Recommendation and remaining evidence

**Recommendation: approve A2A with the section-7 remediation as its blocking stage 0.** A2B and A2C stay unapproved.

Before A2A approval: this plan's schemas, the remediation list and the compatibility design need your sign-off. Before A2B: a green `verify`, deployed dark A2A infrastructure, and a real Wave 0 baseline measured over at least one full trading week. Before A2C: a passing A2B observation period with no Wave 0 regression and a successful rollback drill. Before any `shadow` promotion: 10 (preferably 20) real completed trading days of per-instrument spread and readiness evidence — time that has not elapsed and cannot be simulated.
