# Phase A — Data and Architecture Foundation (remaining work)

## 1. Executive feasibility verdict

Feasible, and smaller than the brief assumes. A verification pass against HEAD and the live database shows that roughly half of Phase A is already built and merged. What remains is telemetry, provenance versioning, suppressed-candidate research enrolment, admin diagnostics, and the controlled `disabled → data_validation → shadow` walk. No destructive migration is required; every remaining change is additive and independently reversible.

## 2. Corrections to the brief (verified, not assumed)

| Brief assumption | Verified status | Evidence |
| --- | --- | --- |
| Instrument definitions fragmented across four files | Already solved | `src/lib/instruments/registry.ts` is the authority; `scanner/types.ts`, `db-types.ts`, `risk.ts` derive from it |
| Lifecycle schema must be designed | Already deployed | `instrument_lifecycle` + `instrument_lifecycle_transitions` exist; 8 symbols seeded, Wave 1 all `disabled` |
| Lifecycle gates must be written | Already written, **not yet enforced** | `execution_controls.lifecycle_enforced = false` today; gates in `pipeline.server.ts`, `revalidate.server.ts`, `direct-enqueue.server.ts` |
| Per-instrument breakers needed | Already solved | `instrument_health.consecutive_failures`, `failure_scope`, `breaker_open_until` (3 rows, Wave 0 only) |
| Readiness/mapping/spec checks needed | Already solved | `src/lib/instruments/readiness.server.ts` |
| Existing-user preference protection needed | Already solved | `eligibility.ts` pins empty arrays to `WAVE0_SYMBOLS` |
| Spread/session versioning exists | Confirmed missing | no `session_version` anywhere; `market_context.trading_session` is bare text |
| Suppressed V1 candidates get outcomes | Confirmed missing | `research_candidates` = 0 rows; `candidate_enrolment_enabled = false` |

So Phase A's remaining scope is A7, A8, A9 (admin surfacing only), A10, A11 (verification only), A12, A13, A14, plus activation.

## 3. Remaining workstreams

### P1 — Cost/spread telemetry (A7)
New table `spread_samples` (raw) + `spread_stats` (aggregate). Raw row: instrument, source account, bid, ask, spread_price, spread_points, spread_atr_fraction, session, session_version, source_time, received_at, market_open, quality. Sampled by a new `/api/public/cron/spread-sample` worker on the existing 15-minute cadence, one quote per non-`disabled` instrument, service-role only, hard row cap per run. Aggregates recomputed daily: median, p90, p95, sample count, per session bucket. Retention: raw 60 days, aggregates permanent. Wave 0 spread floors in the registry stay literal and untouched — telemetry is read by nobody in the decision path during Phase A. A pair may leave `data_validation` only when it has ≥ 200 valid open-market samples across ≥ 3 sessions and a derived floor candidate; the floor is still written by a human-approved registry edit, never auto-adopted.

### P2 — Session and provenance versioning (A8, A12)
Register the current fixed-UTC definition as `session_version = 1` in a `session_definitions` table. Add nullable `session_version` to `market_context` and to research observation rows; existing null rows are defined in docs as "v1, fixed UTC, unstamped". No new session algorithm in Phase A. Provenance fields added to the research rows only where truthfully populatable: strategy model version, strategy manifest hash, symbol-mapping verified-at, candle source, market-data as-of, spec as-of, lifecycle stage at detection, research cohort.

### P3 — Suppressed-candidate research enrolment (A10, A11)
Single outcome authority: reuse `shadow_executions` for outcomes and `research_candidates` for pre-publication capture — no third path. In `pipeline.server.ts`, when a graded V1 setup is suppressed by `mayPublish() === false`, write a frozen counterfactual plan through the existing `enrol-candidates.server.ts` code path with a distinct cohort label (`lifecycle_suppressed`), never touching `scanned_signals`. Consequences: no feed row, no alert fan-out, no `enqueue_execution_deliveries` trigger, no MCP visibility. Idempotency via the existing structure-claim + unique observation key. Enrolment failure is caught and logged; it can never change the scan result. Resolution runs on the existing shadow resolver, which already handles never-filled, gap, TP1/2/3, stop, expiry, same-candle ambiguity and missing candles — extended only with per-instrument isolation so a USDJPY replay outage cannot stall Gold.

### P4 — Admin diagnostics (A9, A14)
New `InstrumentLifecyclePanel` in the existing admin intelligence route, fed by one `get_admin_instruments()` security-definer function: registry definition, stage, last transition (reason/approver), broker mapping + verified-at, spec freshness, quote freshness, candle completeness by timeframe, breaker status, spread-sample maturity, enrolment and resolved/unresolved counts. No secrets, logins, provider payloads or account IDs. Runbook added to `docs/OPERATIONS.md` for mapping ambiguity, missing symbol, stale specs, incomplete candles, queue backlog, resolver backlog, breaker trip, lifecycle rollback, provider outage.

### P5 — Capacity measurement, then activation (A13, then the walk)
Measure before widening: record job duration p50/p95/p99, cycle duration, queue age and provider error rate per instrument for one week at three instruments; that becomes the baseline. Then, one instrument at a time:
1. Flip `lifecycle_enforced = true` while all Wave 1 pairs are still `disabled` — a pure no-op proof that the gates hold.
2. Move one pair to `data_validation`; it fetches candles and quotes, collects health and spread telemetry, publishes nothing.
3. After a clean readiness report and spread maturity, move that pair to `shadow`; it evaluates, enrols and resolves — still publishes nothing.
Repeat per pair. Immediate rollback on any single severe failure (cycle duration above budget, provider error rate spike, resolver backlog growth): set that symbol back to `disabled` — one row update, no deploy.

## 4. Tests

Parity (must stay green, extended): the existing registry-parity suite plus semantic parity for XAUUSD/GBPAUD/EURUSD across direction, grade, entry, stop, TP1-3, R multiples, max acceptable entry, structure key, duplicate suppression, confidence, pillars, publication, feed and alert eligibility, daily cap, sizing, conversion, enqueue, pre-send decision, broker payload, reconciliation, performance grouping. Added nullable provenance columns are excluded by name from the comparison, and that exclusion list is itself asserted.

Per new pair: lifecycle default is `disabled`; suppressed stage yields no `scanned_signals` row, no alert, no webhook, no MCP signal, no automatic enqueue, no broker submission even with enforcement off; exact broker mapping and refusal on ambiguity/unavailability; USDJPY precision and point/pip conversion (3 digits, not 5) across entry, stop, targets, max-acceptable-entry, structure key and display; conversion routes for USD/EUR/GBP/AUD account currencies including missing, stale, future and unparseable timestamps; spread telemetry validity and closed-market exclusion; per-instrument breaker isolation; enrolment idempotency; cohort separation from V1 production and V2/V3.

## 5. Red-team findings that changed this plan

- **Fail-open risk if enforcement is flipped carelessly.** Fixed by ordering: enforce first while Wave 1 is `disabled`, so the flip is provably a no-op before any pair moves.
- **Two outcome authorities.** The brief's "research_candidates or shadow_executions or both" invited a split. Resolved: candidates capture, shadow_executions resolve, nothing else.
- **Auto-adopted spread floors.** Telemetry deriving a floor that silently enters the decision path would be an unvalidated financial input. Resolved: floors remain human-approved registry literals in Phase A.
- **Backfill starving live scans.** Resolved by excluding historical backfill from Phase A entirely.
- **Rollback existing only on paper.** Resolved: rollback is a single `instrument_lifecycle.stage` update plus the `lifecycle_enforced` flag, and the rollback drill is an exit criterion, not a note.

Residual risks accepted: research volume growth (bounded by row caps and retention); MetaApi quota under eight instruments (mitigated by staged, one-pair-at-a-time activation and measured baselines).

## 6. Explicitly out of scope

News provider and blackout enforcement, predictive training/scoring, holdout promotion, `signals_only` and `execution_approved` transitions, alerts or automatic execution for new pairs, correlated-exposure hard blocking, Wave 2, any public or homepage claim about expanded coverage.

## 7. Decisions I need from you

1. Activation order for the five pairs — I propose GBPUSD first (closest to existing EURUSD mechanics), USDJPY last (precision risk).
2. Spread-sampling cadence: reuse the 15-minute scan cron, or a separate 5-minute sampler for finer session detail at higher provider cost?
