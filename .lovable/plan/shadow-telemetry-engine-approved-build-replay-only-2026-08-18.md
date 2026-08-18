# Shadow Telemetry Engine — Approved Build (Replay-Only)

Demo-broker execution is removed entirely: no `shadow-broker.server.ts`, no `demo_ticket_id`, no `demo_error`. All labels come from deterministic Triple-Barrier M15 candle replay against real fetched candles. No mock or seeded rows anywhere.

## Architecture

```text
scanned_signals INSERT
        │  AFTER INSERT trigger (in-transaction, no network, no latency)
        ▼
shadow_queue ── statement kick ──► /api/public/worker/shadow
                                        └─ claim job, create shadow_executions row (status 'open')

pg_cron hourly ─► /api/public/cron/shadow-resolve
                       │ 1 batched M15 candle fetch per instrument (max 3 per run)
                       ├─ triple-barrier replay: fill → TP/SL → time barrier
                       ├─ MFE / MAE in R, bars_to_outcome, realized_r, slippage
                       └─ ml_target_label 1 (TP1+) / 0 (stop, expired, never filled)
```

The live scan path gains exactly one in-transaction insert. No awaited network call, no extra query in `processNextJob`, no change to feed rendering.

## Phase 1 — Schema (migration)

- `shadow_executions` — `signal_id` (unique FK), `instrument`, `grade`, `direction`, `detected_at`, entry/stop/TP + `tp1_r`/`tp2_r`/`max_r` snapshot, `risk_price`, `confidence_score`, `status` (`pending`/`open`/`resolved`/`failed`), `filled_at`, `fill_price`, `execution_slippage_pips`, `max_favorable_excursion_r`, `max_adverse_excursion_r`, `bars_to_outcome`, `realized_r`, `resolved_outcome` (`win`/`loss`/`expired`/`never_filled`), `ml_target_label` (smallint, null until resolved), `replay_cursor`, `bars_replayed`, `last_polled_at`, `resolved_at`, `error`, timestamps. Flat and numeric — one row per signal, joinable to `scanned_signals` + `market_context` on `signal_id` for direct XGBoost export.
- `shadow_queue` — `signal_id`, `status`, `attempts`, `result`, `error`, lease timestamps, plus `claim_shadow_job()` (SECURITY DEFINER, `FOR UPDATE SKIP LOCKED`) and `maintain_shadow_queue()` for lease reclaim/pruning.
- `shadow_engine_state` — single row: `paused`, `consecutive_failures`, `last_error`, `last_run_at` (circuit breaker read by every entry point).
- `signal_user_telemetry` — `user_id`, `signal_id`, `event` (`skipped`/`taken`/`viewed`), unique on the triple.
- RLS: shadow tables enabled with **no** anon/authenticated policies and grants only to `service_role`. Telemetry: owner-scoped insert + select for `authenticated`; no update/delete.
- Triggers: `shadow_enroll_on_signal` (row-level, enqueues), `shadow_queue_kick_worker` (statement-level → `private.kick_shadow_worker()` reusing the existing `private.scanner_config` URL + secret pattern).

## Phase 2 — Worker

- `src/lib/execution/shadow_worker.ts` — `claimAndInitialize(db)`: claims a job, reads the signal, inserts the `shadow_executions` snapshot idempotently (unique `signal_id` collision = already enrolled → mark job done), marks queue row done/failed.
- `src/routes/api/public/worker/shadow.ts` — cron-secret gated (`authorizeCronRequest`), bounded batch (max 5 jobs, 10s wall-clock budget), exits early when `shadow_engine_state.paused`.

## Phase 3 — Hourly resolution

- `src/lib/execution/replay.ts` — pure triple-barrier maths over `Candle[]`:
  - unfilled limit entry: fill when a candle trades through `entry_price` within the TIF window (`ORDER_TIF_MINUTES`, measured on candle timestamps); otherwise `never_filled` / label 0.
  - `fill_price` = entry (limit semantics); `execution_slippage_pips` = gap between candle open and entry when the bar gapped through, in instrument pips.
  - after fill, per candle: update MFE/MAE in R; stop hit → `loss`, label 0, `realized_r = -1`; TP1 reached → `win`, label 1, `realized_r` = highest target R reached (TP2/TP3 escalate); intrabar ambiguity resolved stop-first (conservative).
  - vertical barrier: `SIGNAL_MAX_AGE_HOURS` past `detected_at` with no barrier hit → `expired`, label 0, `realized_r` = MFE-at-close excursion recorded but label stays 0.
- `src/lib/execution/shadow_resolve.ts` — loads open rows, groups by instrument, one `fetchCandles(instrument, "M15", 200)` per instrument, replays each row from `replay_cursor` (or `detected_at`), writes only when state advances (idempotent), bumps `last_polled_at`.
- `src/routes/api/public/cron/shadow-resolve.ts` — cron-secret gated, calls `maintain_shadow_queue()`, bounded batch (200 rows), paused-state guard, MetaApi timeout/closure-safe: zero new candles → clean no-op exit; repeated fetch failures increment `consecutive_failures` and pause at 5.
- pg_cron: hourly `POST` to `/api/public/cron/shadow-resolve` with the `apikey`/`x-cron-secret` header pattern already used by the scan cron.

## Phase 4 — Behavioural telemetry

- New `src/lib/telemetry.functions.ts` (`recordSignalEvent`, auth middleware, upsert-on-conflict-ignore).
- `src/routes/_authenticated/feed.tsx`: the existing `decide()` handler fires the telemetry write fire-and-forget (`void`, errors swallowed, never blocks the button or the toast). `SignalCard.tsx` keeps its current props and behaviour.

## Out of scope

No Python training code, no model inference, no change to grading, `profile.ts`, the live feed queries, or the daily cap.
