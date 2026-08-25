# Phase A1 — Foundation Audit and Hardening

## Audit checkpoint (verified before planning)

HEAD is `c7a9dcc02eabdc6f8f1d0e1906f1783f2bf1a589` — identical to the reference commit, so the audit is against the intended tree.

Live state: `execution_controls.lifecycle_enforced = false`. `shadow_engine_state`: `v2_enabled=false`, `v3_enabled=false`, `candidate_capture_enabled=false`, `candidate_enrolment_enabled=false`, `replay_v2_shadow_enabled=false`, `sizing_v2_enabled=false`, `active_replay_version=1`, `paused=false`. Lifecycle rows: XAUUSD, GBPAUD, EURUSD = `execution_approved`; AUDUSD, GBPUSD, USDCAD, USDCHF, USDJPY = `disabled`. Row counts: `research_candidates` 0, `shadow_executions` 482, `model_observations` 2591, `instrument_health` 3 (Wave 0 only). No Wave 1 instrument is active, visible or execution-capable.

## Finding-by-finding verdict

| # | Verdict | Evidence |
| --- | --- | --- |
| 1 Lifecycle stages don't enforce distinct capabilities | **Confirmed** | Only `mayScan`/`mayPublish`/`mayExecute` exist (`lifecycle.ts`). In `pipeline.server.ts` V2 runs at line ~449 and V3 at ~487, while the publication gate is at line 539 — strategy evaluation and shadow enrolment precede the lifecycle decision. The stage is read once at line 266 and reused for the whole job. |
| 2 Suppressed candidates misclassified | **Confirmed — real defect** | `pipeline.server.ts:299-304`: the status→observation mapper returns `decision: "no_trade"` for every unhandled status, and `skipped` is unhandled. A valid structure suppressed at line 539 is therefore recorded as a strategy no-trade. |
| 3 Suppressed capture already exists | **Partially confirmed** | `captureCandidate` is called at ~line 393 behind `isCandidateCaptureEnabled`, passing `v1Decision: status`, so `skipped` *is* distinguishable in that column. But there is no cohort column, no lifecycle-stage column, and capture sits inside the same observation block for every status. Table is empty (0 rows), so nothing needs reclassifying. |
| 4 Transitions not atomic | **Confirmed** | `lifecycle.server.ts` `transitionStage` inserts history, then updates the row in a second call. No transition-graph validation, no expected-from check, no reason/approver validation, no locking. A failed second call leaves history for a transition that never happened. |
| 5 Mapping conflated with specification | **Confirmed** | `readiness.server.ts:74-81`: the `mapping` check is literally `spec !== null` with the detail string "run the specification refresh first". Mapping is never independently verified. |
| 6 Readiness insufficient | **Partially confirmed** | Five components are reported separately (good, contrary to the brief's fear of one boolean), but candle checks do not test interval continuity, duplicate timestamps or incomplete current candles, and conversion is checked for one route rather than per account currency. |
| 7 Price normalization incomplete | **Confirmed, with a brief correction** | `ENTRY_PRICE_DECIMALS = 5` in `scanner/types.ts` is used by `pipeline.server.ts` for duplicate identity. **Correction:** the brief (and a code comment at `pipeline.server.ts:124`) claims a database unique index `scanned_signals_active_unique` on `round(entry_price, 5)`; no such expression index exists in the live database. Duplicate identity is enforced in code, not by that index. The stale comment is itself a defect. |
| 8 Provenance | Confirmed as work-to-do | `research_candidates` already carries `manifest_hash`, `code_hash`, `observation_key`, `run_id`; it lacks lifecycle stage, provider symbol, cohort, session version and data as-of. |
| 9 Session versioning | Confirmed missing | No `session_version` anywhere; `market_context.trading_session` is bare `text`. |
| 10 Parity proof thin | Confirmed | Existing parity suite pins registry literals only, not end-to-end decisions. |

## Corrections to the brief

1. The `round(entry_price, 5)` index does not exist — no migration should be written against it; the comment gets corrected instead.
2. Readiness already reports components separately; only the checks inside them need deepening.
3. `research_candidates` is empty, so Finding 2's "historical rows must not be reclassified" is moot for that table. `model_observations` (2591 rows) does contain the misclassification risk, but only for Wave 0 rows produced while enforcement was off — i.e. no lifecycle suppression ever occurred, so no historical row is wrong today. The fix is purely forward-looking. This is the honest reading and it will be documented rather than backfilled.
4. Capability matrix correction: `data_validation` must **not** run strategy evaluation at all. The brief's matrix agrees; the current code disagrees because V2/V3 run before any stage check. This is the single most important behavioural fix in A1.

## Implementation packages

Each package is independently revertible. No flag values change, no lifecycle row moves, no migration is destructive.

**P1 — Capability model (Finding 1).** Extend `src/lib/instruments/lifecycle.ts` with `mayCollectData`, `mayEvaluateStrategy`, `mayCaptureResearch`, `mayResolveResearch`, `mayAlert` alongside the existing three, all derived from the same rank ladder so no stage answer can drift. In `pipeline.server.ts`, move the lifecycle read's verdicts to the action boundaries: guard the V2 block and the V3 block with `mayEvaluateStrategy`, guard `captureCandidate` with `mayCaptureResearch`, and re-read the stage immediately before the publication write rather than relying on the line-266 snapshot. Add `mayAlert` to the alert fan-out and re-check `mayExecute` at the pre-send boundary in `revalidate.server.ts` (it is already checked there; the change is that it re-reads rather than trusting a passed-in view). Fail closed on a degraded read for any non-Wave-0 symbol.

**P2 — Research classification (Finding 2).** Replace the catch-all `no_trade` mapper with an exhaustive, non-overlapping classification: `no_trade`, `published`, `suppressed_lifecycle`, `suppressed_cooldown`, `suppressed_duplicate`, `research_shadow`, `evaluation_error`, `data_unavailable`, `job_stale`, `operationally_skipped`. Observation rows gain a `suppression_reason` column (nullable) and lifecycle suppression maps to `decision: "candidate"` with a suppressed disposition — never to `no_trade`. Statistics readers filter on the disposition, so a suppressed candidate cannot enter a rejection denominator.

**P3 — Transactional transitions (Finding 4).** New `transition_instrument_stage(_symbol, _expected_from, _to, _reason, _approver, _evidence, _rollback_target)` security-definer function with `set search_path = public`, granted to `service_role` only. It selects the current row `for update`, rejects a mismatch against `_expected_from`, validates the destination against an explicit allowed-transition graph (`disabled→data_validation→shadow→signals_only→execution_approved`, any stage→`suspended`, `suspended`→its rollback target, plus one-step-back rollbacks), rejects blank reason or approver, inserts history and updates the row in the same transaction. `transitionStage` in `lifecycle.server.ts` becomes a thin caller. Rollback is the same function, never a bare update.

**P4 — Mapping authority (Finding 5).** Split mapping from specification. A `resolveBrokerSymbol` path returns a discriminated result: `exact | configured | inferred | ambiguous | unavailable`, with the account/server scope, the provider symbol and a `verified_at`. `connected_account_symbols` is reused (it already keys per account); the gap is a resolution status and verified-at, added as nullable columns. Readiness's `mapping` check calls this instead of testing for a spec. Ambiguous, stale and unavailable all fail closed. No fuzzy matching: suffix/prefix candidates must match the canonical base exactly, and more than one surviving candidate is `ambiguous`, not a guess. No candle or quote request is issued for an unresolved canonical symbol.

**P5 — Readiness depth (Finding 6).** Candle validation gains ascending-order, duplicate-timestamp, interval-continuity, missing-interval, incomplete-current-candle, OHLC-geometry and non-finite checks per timeframe. Quote validation gains bid/ask geometry, positive spread, future-timestamp and market-open checks (source-time staleness already exists). Spec validation reports each provider field present/absent separately. Conversion becomes a matrix over USD/EUR/GBP/AUD account currencies with route type and refusal reason per cell.

**P6 — Instrument-aware precision (Finding 7).** Introduce `src/lib/instruments/precision.ts`: `priceDecimals(symbol, spec)` preferring the broker's `digits`, falling back to the registry's `fallbackDigits`; `normalizeToTick(price, spec, direction)` snapping to the broker `tickSize`/`point` grid with deterministic direction — stops away from entry, limits toward the trader, so rounding never silently increases risk. Duplicate identity becomes `entryPriceKey(symbol, price)` using instrument digits; **for Wave 0 this returns exactly the current 5-decimal result**, pinned by test. Order-grid normalization applies at the broker boundary only; research and display use registry digits as fallback. The stale index comment is corrected.

**P7 — Provenance and session version (Findings 8, 9).** Additive nullable columns on `research_candidates` and the observation rows: `canonical_instrument`, `provider_symbol`, `lifecycle_stage_at_detection`, `research_cohort`, `session_version`, `candle_source`, `candle_as_of`, `quote_as_of`, `spec_as_of`, `mapping_verified_at`. New `session_definitions` table registering the current fixed-UTC algorithm as version 1. `session_version` added nullable to `market_context`. Nothing is backfilled; null is documented as the named legacy cohort "v1-unstamped". No DST-aware algorithm.

**P8 — Wave 0 parity proof (Finding 10).** Golden-fixture dual-run: deterministic candle fixtures per Wave 0 instrument feed `evaluateSetup` and the downstream chain, and the full decision object is compared against committed goldens covering direction, gates, rejection reasons, grade, entry, stop, TP1-3, R multiples, max acceptable entry, structure key, duplicate key, confidence, pillars, publication, feed and alert eligibility, daily cap, default instrument resolution, sizing, conversion, enqueue, pre-send decision, broker payload, reconciliation grouping and shadow resolution. New nullable provenance fields are excluded only through a named exclusion list that the test itself asserts is complete.

**P9 — Documentation.** `docs/INSTRUMENT-LIFECYCLE.md` gains the capability matrix, transition graph, degraded-read semantics and rollback procedure. New sections in `docs/DATA-PROVENANCE.md` (legacy cohort, session version), `docs/BROKER-ACCOUNTS.md` (mapping vs specification), `docs/SCANNER.md` (precision authority). Nothing claims Wave 1 support.

## Migrations (all additive, in order)

1. `session_definitions` table + seed of version 1 + `market_context.session_version` nullable. Grants: `SELECT` to `authenticated` on definitions, `ALL` to `service_role`; RLS on with a read-only authenticated policy.
2. Provenance columns on `research_candidates` and observation tables, all nullable, no defaults, no backfill.
3. `suppression_reason` column on the observation table.
4. Resolution-status and `verified_at` columns on `connected_account_symbols`, nullable.
5. `transition_instrument_stage` function, `service_role`-only EXECUTE, `search_path = public`.

Rollback for each: drop the added column or function; every reader treats the columns as optional, so the application tolerates staggered deployment in both directions.

## Stop conditions

Stop and report if the audit turns up a Wave 1 instrument that is scannable, publishable or executable in the live database; if a parity golden differs for Wave 0; or if any required change turns out to need a destructive migration or a flag flip.

## Out of scope (unchanged from your boundary)

No `lifecycle_enforced = true`, no stage moves, no flag changes, no spread-floor changes, no news provider, no predictive work, no backfill, no Wave 1 documentation claims, no broker test orders.

## Phase A2 (to propose after A1, not now)

Spread/cost telemetry, provenance population, stage-correct enrolment, outcome resolution, admin diagnostics, capacity measurement, one-instrument-at-a-time activation — to be written against the A1 evidence rather than copied forward.
