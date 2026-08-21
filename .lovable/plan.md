# Execution-Credible Shadow Replay (Replay Engine v2)

## 1. Goal
Shadow labels must be reproducible statements about what a real pending order could have achieved. Today some labels come from fills that happened after the order had already expired, and R is normalised against planned risk even when the fill price differed. Those labels feed the priors, the weekly report, the admin terminal and the SignalCard intelligence panel, so they must be corrected without rewriting history or touching V1/V2/V3 signal generation.

## 2. Current implementation (re-read at HEAD)
- `src/lib/execution/replay.ts` — single pure triple-barrier replay over M15 candles. TIF = 30m (`ORDER_TIF_MINUTES`), vertical barrier = 24h (`SIGNAL_MAX_AGE_HOURS`), stop-first inside a bar, ladder pays the highest target R touched in the resolving bar.
- `src/lib/execution/shadow_resolve.server.ts` — hourly, 200 rows/run, 1000 M15 candles per instrument, cursor-resumed, writes only on advance.
- `src/routes/api/public/cron/shadow-resolve.ts` — then calls `recompute_regime_stats(1)` and milestone email.
- `shadow_executions` — one row per signal (`UNIQUE (signal_id)`), no replay-version column, no cost columns.
- Consumers: `regime.server.ts`/`regime_stats`, `weekly.server.ts`, `get_admin_intelligence()`, `signal-audit.functions.ts`, `get-shadow-comparison` MCP tool, `export.ts`, `baseline/capture.server.ts`.

## 3. Confirmed defects
- **D1 (P0) — post-expiry fills.** The fill test runs before the TIF check, so a candle whose interval starts after the deadline can still fill the order. Live data: **13 of 88 filled V1 rows (14.8%) filled after the 30-minute deadline, including 8 of 45 wins (17.8%)**. Win-if-filled and the priors are inflated.
- **D2 (P0) — R normalised against planned risk after a non-planned fill.** 17 rows filled away from `entry_price`. A better fill still books exactly `-1R` on a stop and the planned target R on a win; a worse (gap-through) fill understates the loss.
- **D3 — timestamp semantics undocumented.** MetaApi candle `time` is the bar **open**; `replay.ts` mixes bar-open comparisons (`t > tifDeadline`, `t >= verticalBarrier`) with a `+M15_MS` window on the first bar. Deadlines that fall mid-bar are unresolvable at M15 and are currently resolved optimistically.
- **D4 — intrabar ambiguity is unmeasured.** Stop-first is applied silently; there is no flag saying which labels were decided by an ambiguous bar, so nobody can size the bias.
- **D5 — labels are gross.** No spread, commission, slippage or swap modelling, yet the UI and weekly report present win rate and R as if tradeable.
- **D6 — exit policy is implicit.** Replay pays a single all-out exit at the best target touched. Settings/copy describe a TP ladder; there is no versioned execution policy, so replay and product claim can diverge.
- **D7 — no replay versioning.** `UNIQUE (signal_id)` means a corrected replay can only overwrite the faulty result.

## 4. Hidden/secondary risks found
- Correcting D1/D2 changes `regime_stats`, so live priors, EV sorting, "Active" labels, the fill/win learning gates (150/200) and the milestone email all move. Gates are latched in `shadow_engine_state`, and re-labelling can push counts back below a gate that already fired.
- `baseline_snapshots` rows captured from faulty labels stay valid only if labelled with the replay version.
- The resolver's per-version budget (`ACTIVE_MODEL_VERSION` first) becomes a per-(version, replay_version) budget; without that, a v2 re-replay backlog starves live resolution.
- Lower-timeframe adjudication adds MetaApi calls inside a cron already bounded by 8s per fetch — an unbounded ambiguity queue would time out the run.
- `shadow_executions` has no RLS policies (service-role only); new columns inherit that. Safe, but the DB test suite asserts the current shape.

## 5. Alternatives considered

**Correcting the labels (D1/D2)**
- *A. Fix `replay.ts` in place and re-replay existing rows.* Cheapest, one code path. Rejected: destroys the faulty history, so we can never quantify how wrong the old labels were, and every past baseline/report becomes unreproducible.
- *B (recommended). Version the replay engine.* Add `replay_version smallint` (1 = legacy frozen, 2 = corrected), relax `UNIQUE (signal_id)` to `UNIQUE (signal_id, replay_version)`, write corrected rows as new rows, and make every read filter `replay_version = ACTIVE_REPLAY_VERSION`. Preserves history, allows a paired v1-vs-v2 comparison on identical signals, rolls back by flipping one constant. Cost: ~2x rows (325 today — trivial), every consumer needs the filter.
- *C. Separate `shadow_executions_v2` table.* Cleanest isolation but duplicates the resolver, the indexes and every query. Rejected as needless.

**Intrabar ambiguity (D4)**
- *A. Keep stop-first M15 only.* Free, deterministic, but permanently pessimistic and unquantified.
- *B (recommended). M15 replay + M1 adjudication only for ambiguous bars.* A bar is ambiguous when two or more of {entry, stop, any TP} lie inside its range. Flag the bar, fetch M1 for that single interval, adjudicate by first touch, and record `adjudication` = `m15_stop_first` | `m1_resolved` | `m1_unavailable`. Bounded: ambiguous bars are a small minority, and the fetch is capped per run with the M15 fallback retained when M1 is missing. Documented MetaApi behaviour: historical candles are available per timeframe including 1m, same REST endpoint, so no new integration surface.
- *C. Tick adjudication.* Highest fidelity, but tick history is a heavier/costlier endpoint and M1 already resolves ordering for our stop/TP separations (typically ≥ 1.2x ATR apart). Rejected for now; the `adjudication` field leaves room to add it later.
- *D. Full M1/tick replay of everything.* Rejected: ~15x the data volume inside an hourly cron with an 8s fetch ceiling.

**Costs (D5)**
- *A. Bake broker costs into R.* Rejected — we do not have this account's real spread/commission/swap schedule; inventing them violates zero-hallucination.
- *B (recommended). Report gross R always; add explicitly-labelled scenario columns.* Store `gross_r` plus `cost_scenario` (`none` | `spread_only`) and `net_r` only when a documented per-instrument spread exists; otherwise `net_r = NULL` and the UI says "net unavailable".

**Exit policy (D6)**
- Recommended: freeze the current all-out-at-best-target behaviour as named policy `single_exit_best_target` in an `execution_policy` column, so a future ladder/partials policy is a new policy value replayed in shadow rather than a silent redefinition.

## 6. Mathematics
- **TIF, fail-closed.** Candle `time` = bar open; bar covers `[t, t+15m)`. Deadline `D = detected_at + 30m`. Fill is only considered when `t < D`. If `t < D <= t+15m` the touch may have happened either side of the deadline: mark `fill_ambiguous_tif = true` and, unless M1 adjudication resolves the touch minute, treat it as **not filled** (fail-closed). At M15 this removes all 13 known post-expiry fills.
- **Actual-risk normalisation.** With fill `f` and fixed stop `s`, `risk_actual = |f - s|`; all R uses `risk_actual`. A stop then books exactly `-1R` by construction, and a better fill yields a *larger* positive R on the same target: long entry 1.1000, stop 1.0950 (planned 50 pips), TP1 1.1100; gap fill 1.0990 gives risk 40 pips and TP1 R = 110/40 = **2.75R** (planned 2.00R). Both `risk_price_planned` and `risk_price_actual` are stored so the planned-vs-actual divergence is auditable.
- **Vertical barrier** unchanged: 24h after detection, exit at the close of the barrier bar, label 0 regardless of sign.
- **Weekend/missing candles**: no candles → no advance, cursor held. Never inferred.

## 7. Schema changes (one additive migration, no data rewrite)
- `shadow_executions`: add `replay_version smallint not null default 1`, `risk_price_actual numeric`, `gross_r numeric`, `net_r numeric`, `cost_scenario text`, `execution_policy text`, `adjudication text`, `fill_ambiguous_tif boolean not null default false`, `ambiguous_bars integer not null default 0`.
- Drop `shadow_executions_signal_id_key`; add `UNIQUE (signal_id, replay_version)`; add `(status, model_version, replay_version)` partial index for the resolver.
- CHECK constraints on the new enumerated text columns; existing rows stay `replay_version = 1` untouched.
- No RLS change (service-role only, unchanged).

## 8. Backend changes
- `src/lib/execution/replay-version.ts` — `ACTIVE_REPLAY_VERSION = 2` (the rollback switch).
- `src/lib/execution/replay.ts` — keep the current function as `replaySetupV1` (frozen, still covered by its existing tests); add `replaySetupV2` with the TIF gate, actual-risk normalisation, ambiguity detection and policy/cost fields.
- `shadow_resolve.server.ts` — filter and budget by `(model_version, replay_version = ACTIVE_REPLAY_VERSION)`; dispatch to the matching replay function; bounded M1 adjudication (hard cap per run, M15 fallback).
- `shadow_worker.server.ts` / `enrol.server.ts` — stamp `replay_version` and `execution_policy` on enrolment.
- New backfill route `POST /api/public/cron/shadow-rereplay` (cron-secret gated, idempotent, batched) that clones every legacy signal into a `replay_version = 2` pending row; safe to re-run.
- `recompute_regime_stats` — add a `_replay_version` argument defaulting to the active one; V1 priors then read corrected labels only.
- `get_admin_intelligence()`, `weekly.server.ts`, `signal-audit.functions.ts`, `capture.server.ts`, `export.ts` — filter on the active replay version; weekly report gains a `replay_version` line.
- Milestone gates: because corrected labels can move counts below an already-latched gate, re-evaluate gates against v2 counts and re-latch per replay version.

## 9. Frontend / MCP / copy
- SignalCard intelligence + performance/learning tabs: label R as **gross**, show "net unavailable" when `net_r` is null, and surface fill-rate provenance ("30-minute expiry strictly enforced").
- Admin terminal: add a v1-vs-v2 paired panel (same signals, both label sets) plus an ambiguity-rate tile.
- `get_shadow_comparison` and `get_performance_summary` MCP tools: return `replay_version`, `execution_policy`, `cost_scenario` and a gross/net note so agents cannot present gross R as net.

## 10. Test matrix (all blocking)
Fixtures are hand-built M15 bars; expected values hand-calculated.
- Unit/geometry: never filled; filled first bar; filled in the bar that ends exactly at `D`; touch in the bar starting after `D` → `never_filled`; touch inside the bar spanning `D` → fail-closed unless M1 resolves; gap-through better fill (risk 40 pips → TP1 = 2.75R); gap-through worse fill; stop only (−1R exactly on actual risk); TP1; TP2; TP3; stop+TP same bar (stop-first, then M1-adjudicated variant); entry+stop+TP same bar; vertical expiry positive; vertical expiry negative; missing candles (no advance); weekend gap.
- Property/invariant: a resolved loss is always exactly −1R on actual risk; `gross_r >= net_r` when net exists; a better fill never yields a worse R on the same target; replay is idempotent (same candles twice → identical row); `filled_at <= detected_at + 30m` for every v2 row.
- Bearish mirror of every geometry case; malformed inputs (risk 0, NaN, inverted stop) → resolved `never_filled`, never a fabricated label.
- DB tests: new constraints/indexes; `(signal_id, replay_version)` uniqueness; v1 rows immutable; `recompute_regime_stats` ignores non-active replay versions; RLS still denies anon/authenticated.
- Failure injection: M1 fetch timeout → `m1_unavailable` + M15 fallback; duplicate/concurrent cron runs → no double rows; partial write failure mid-batch → cursor unchanged, replay resumes; stale cursor; provider 429/504 → instrument skipped, breaker counts only when all instruments fail.
- Regression: existing `replay.test.ts` / `replay.v2.test.ts` continue to pin V1 legacy behaviour unchanged.

## 11. Baseline to capture before implementation
From current data (V1, `replay_version = 1`, 2026-08-11 → 2026-08-21, 3 instruments): 325 rows, 315 resolved, 88 filled (fill rate 27.9%), 45 wins / 43 losses, 227 never-filled, 13 post-expiry fills, 17 non-planned fills, mean R −1.000 (losses) / 0.970 (wins). Also snapshot grade/instrument/session/direction distribution, miss-distance median, `regime_stats` at both learning gates, weekly-report figures, admin tiles and MCP outputs into a `baseline_snapshots` row tagged `replay_version = 1`. **Not derivable today:** net-of-cost R (no broker cost schedule) and any M1-adjudicated ambiguity rate — both reported as unavailable, not estimated.

## 12. Sequence
1. Capture the baseline snapshot. 2. Additive migration. 3. `replay-version.ts` + `replaySetupV2` with full unit/property tests. 4. Resolver version-awareness + bounded M1 adjudication. 5. Backfill route; re-replay the 325 legacy signals into v2 rows. 6. `recompute_regime_stats` version argument; re-run for v2. 7. Consumer filters (reports, admin, audit, export, MCP). 8. UI copy + paired comparison panel. 9. Gate re-latch. 10. Publish.

## 13. Deployment, rollback, kill switches
Backfill runs behind the cron secret and is idempotent. Rollback = set `ACTIVE_REPLAY_VERSION` back to 1 and re-run `recompute_regime_stats` for replay version 1; all v1 rows are still present, so nothing is lost. `shadow_engine_state.paused` remains the hard kill switch; M1 adjudication gets its own flag so it can be disabled without reverting the TIF fix. The migration is additive, so forward-fix is a further additive migration, never a destructive down-migration.

## 14. Acceptance criteria
No v2 row has `filled_at` later than `detected_at + 30m`; every resolved loss is exactly −1R on actual risk; v1 rows byte-identical after the backfill; priors, weekly report, admin and MCP all report one replay version; the paired v1-vs-v2 comparison is visible in the admin terminal; full blocking suite green.

## 15. What I cannot guarantee
That corrected fill/win rates stay above the 150/200 learning gates (they may fall, and that is the honest outcome); that M1 adjudication resolves every ambiguous bar (some will stay `m15_stop_first`); that net-of-cost R becomes available without a documented broker cost schedule; that MetaApi retains 1m history depth far enough back to adjudicate the oldest samples.

## 16. Recommendation
Proceed with the versioned replay engine (Alternative B) plus bounded M1 adjudication (B), gross-R-with-labelled-scenarios costs, and a frozen named execution policy. Do not fix `replay.ts` in place.
