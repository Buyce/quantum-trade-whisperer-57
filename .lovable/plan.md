# Shadow Telemetry Engine — Architectural Audit + Build Plan

## Verdict on the proposed architecture

The four-phase intent is sound (meta-labeling needs a clean, unbiased, forward-tested label set). Two of the four phases need changing before they are safe to build.

### Challenge 1 — Broker demo orders are the wrong primary label source
Firing real orders into the hardcoded MetaApi demo account to learn outcomes has hard problems:

- MFE/MAE cannot be recovered from a closed ticket. MetaApi returns open/close price and profit, not the excursion path. Any MAE/MFE derived from tickets would be a guess — a fatal flaw for meta-labeling, since the excursion path *is* the feature set.
- One demo account, many signals: margin, exposure caps and correlated positions (XAUUSD + EURUSD + GBPAUD at once) mean the broker itself can reject or partially fill setups. That is selection bias baked into the training data.
- Demo fills are simulated anyway. Their "slippage" is synthetic, so it does not transfer to live execution.
- Weekend/holiday closures, symbol suffix mismatches and rejects each add a failure mode that must be reconciled per-ticket.

**Recommended primary engine: deterministic candle-replay labeling.** For every signal, replay M15 candles from `detected_at` forward through the existing `fetchCandles` path and compute the triple-barrier outcome (Lopez de Prado's own formulation): TP barrier, SL barrier, vertical time barrier. This gives exact MFE/MAE in R, exact time-to-outcome, exact fill/no-fill on limit entries, and it is fully reproducible and backfillable over historical signals — which the broker route can never be. Cost: one batched candle fetch per instrument per hour, shared by every open shadow row on that instrument. That is 3 requests/hour total, versus one ticket poll per open position.

**Keep the demo account, but demoted to a slippage-calibration side channel**: optionally mirror only A+/A setups as real demo orders to measure realised entry slippage and fill latency, stored on the same row. If it fails, rejects, or the market is closed, the row still gets its label from replay. This is exactly how QuantConnect/Numerai-style pipelines separate *label generation* (deterministic simulation) from *execution realism* (a small live/paper sample).

### Challenge 2 — Postgres trigger → HTTP is the wrong decoupler here
The project already has a proven decoupling primitive: `scan_queue` + `claim_scan_job()` + the `kick_scan_worker` trigger. Adding a second mechanism (Supabase DB webhooks or an edge function) adds a moving part with no benefit. Reuse the same pattern with its own queue table, so:

- zero blocking work in `pipeline.server.ts` (it does one non-awaited-path insert of a queue row, nothing else),
- single-flight claiming via `FOR UPDATE SKIP LOCKED`,
- bounded work per invocation and idempotent progress marking,
- no new server cost, no new auth surface.

Enrolment itself does not even need to live in the pipeline: an `AFTER INSERT` trigger on `scanned_signals` can enqueue the shadow job in-transaction (microseconds, no network), which is strictly safer than application code for guaranteeing zero latency and zero missed signals.

### Challenge 3 — Scope of enrolment
Enrolling only B/C and user-skipped setups produces a label set that cannot train a model for the grades you actually trade. Meta-labeling requires labels for *every* primary-model signal, including A+/A. Recommendation: enrol **all** signals; carry `grade` and `was_taken_by_any_user` as features. Behavioral skip data becomes a feature, not a filter.

## Finalized architecture

```text
scanned_signals INSERT
        │  (AFTER INSERT trigger, in-transaction, no network)
        ▼
shadow_queue ──── kick ────► /api/public/worker/shadow  (bounded, single-flight)
                                    │
                                    ├─ create shadow_executions row (pending)
                                    └─ optional demo order (A+/A only, fire-and-forget)

pg_cron hourly ─► /api/public/cron/shadow-resolve
                       │ 1 batched M15 candle fetch per instrument
                       ├─ triple-barrier replay for all open rows
                       ├─ MFE / MAE in R, time-to-outcome, fill state
                       └─ ml_target_label 1/0, outcome, resolved_at
```

Live-path guarantee: the only change inside the live scan path is a Postgres trigger insert. No `await` on MetaApi, no HTTP, no extra query in `processNextJob`. Feed and card rendering are untouched.

## Phases

### Phase 1 — Schema (isolated data lake)
New tables, none referenced by any user-facing query:

- `shadow_executions` — `signal_id` (FK, unique), `instrument`, `grade`, `direction`, entry/SL/TP snapshot, `filled_at`, `fill_price`, `execution_slippage_pips`, `max_favorable_excursion_r`, `max_adverse_excursion_r`, `bars_to_outcome`, `resolved_outcome` (`win`/`loss`/`expired`/`never_filled`), `realized_r`, `ml_target_label` (smallint 0/1, null until resolved), `demo_ticket_id`, `demo_error`, `status` (`pending`/`open`/`resolved`/`failed`), `last_polled_at`, timestamps.
- `shadow_queue` — mirrors `scan_queue` semantics (`signal_id`, `status`, `attempts`, lease timestamps) with a `claim_shadow_job()` security-definer function.
- `signal_user_telemetry` — `user_id`, `signal_id`, `event` (`skipped`/`taken`/`viewed`), `created_at`, unique on (user_id, signal_id, event).

ML-export shape: one flat row per signal, joinable to `scanned_signals` + `market_context` on `signal_id`, all numeric features already numeric, single binary target, plus `detected_at` for purged/embargoed time-series CV. No JSON blobs, no arrays.

Grants + RLS: `service_role` full; `authenticated` gets SELECT on an aggregate-only view (or nothing) — raw shadow rows stay server-side. `signal_user_telemetry`: owner-scoped insert/select.

### Phase 2 — Decoupled enrolment
- Trigger `shadow_enroll_on_signal` AFTER INSERT on `scanned_signals` → insert into `shadow_queue`, plus a statement-level kick trigger reusing the existing `private.kick_scan_worker` pattern pointed at the shadow worker.
- `src/routes/api/public/worker/shadow.ts` — cron-secret protected, claims up to N jobs, creates the `shadow_executions` row, and (only for A+/A, and only if `SHADOW_DEMO_ORDERS` is enabled) places one demo limit order via a new `placeDemoOrder` in a `shadow-broker.server.ts` module with the same 8s abort discipline. Any broker failure records `demo_error` and leaves the row on the replay path.
- `src/lib/execution/shadow_worker.ts` — claim/label/resolve logic, no HTTP concerns.

### Phase 3 — Hourly resolution loop
- `src/routes/api/public/cron/shadow-resolve.ts` + pg_cron hourly.
- Per run: read open rows, group by instrument, fetch M15 candles **once per instrument** (≤3 requests/run), replay each row's barriers from `detected_at`, update MFE/MAE/label idempotently.
- Weekend/closure safety: no new candles ⇒ nothing to update, run exits cleanly. TIF expiry uses candle timestamps, not wall clock, so a market-closed gap never mislabels a setup as `never_filled`.
- Vertical barrier: resolve as `expired` once the replay window passes the signal's retention horizon; `ml_target_label = 0`.
- Bounded batch size, lease-based single flight, circuit breaker that parks the job after repeated broker failures.
- Optional demo-ticket reconciliation for the A+/A sample: batched `history-orders`/`deals` pull by time range (one request), never per-ticket; partial fills recorded as `fill_price` volume-weighted, and a rejected/zero-volume ticket falls back to replay.

### Phase 4 — Behavioral alpha telemetry
- `Log as Skipped` / `Log as Taken` in `SignalCard.tsx` keeps its current behaviour and additionally fires a fire-and-forget telemetry write (server fn, no await blocking the UI, failure swallowed silently).
- Aggregated later into a `skip_rate` feature at export time — never read on the render path.

## Out of scope
No Python training code, no model inference in the app, no change to grading, `profile.ts`, or the live feed. Model training happens offline against the exported dataset.
