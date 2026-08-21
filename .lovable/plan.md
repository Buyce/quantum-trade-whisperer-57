# V2 Grading Shadow — Revised Architecture (PLAN ONLY)

Prompt 3C corrections folded in. P1–P7 from the previous review are preserved and restated where they still bind. No implementation in this prompt.

## A. Corrections carried forward (P1–P7)

- **P1** V2 cohort is identified by `model_version = 2` only. `signal_id IS NULL` is not a V2 marker: 145 existing V1 rows already have a null `signal_id` because tiered retention deleted their signal.
- **P2** `shadow_queue` cannot carry V2 (`signal_id NOT NULL` + FK to `scanned_signals`, populated only by the `enroll_shadow_signal` trigger). V2 rows are inserted directly into `shadow_executions` with `status = 'pending'`; `shadow_resolve.server.ts` already reads non-active versions on a leftover budget.
- **P3** V2 needs its own cooldown or the cohort is autocorrelated (one lingering structure would otherwise produce a row every 15 minutes).
- **P4** The "byte-identical V1 replay over resolved rows" test is impossible — no candle history is stored. Superseded by §J frozen-fixture proof.
- **P5/P6** No `regime_stats`, `recompute_regime_stats` or `scanned_signals` changes. Only `shadow_executions` gains taxonomy columns.
- **P7** Kill switch lives in the database (`shadow_engine_state`), not an env var, so it is flippable during an incident without a publish.

## B. Corrected control flow (fixes the early-return defect)

Today `processNextJob()` returns at `no_trade` and at the cooldown `duplicate` branch, so anything placed after those returns can only ever observe the "V1 traded and published" cell. The job is restructured so evaluation happens before any policy return:

```text
claim job
  fetch H4/H1/M15 candles  -> on failure: V1 health path unchanged, no observations
  freeze snapshot (candles, now, session, run_id)
  evaluate V1  (existing buildTradeProfile, byte-identical inputs)
  evaluate V2  (pure modules, wrapped in try/catch)
  persist model_observations: one row for V1, one row for V2  <-- always
  ---- V1 publication policy, unchanged ----
  no_trade | cooldown | 23505 | published  (same returns, same order, same details)
  update the V1 observation row with its disposition
  ---- V2 research policy, isolated ----
  if V2 decision = candidate AND V2 atomic cooldown claim succeeds
     insert one shadow_executions row (model_version 2)
     write its id back onto the V2 observation row
```

All four cells are therefore reachable and durable: V1 trade/V2 trade, V1 trade/V2 no-trade, V1 no-trade/V2 trade, V1 no-trade/V2 no-trade — and V1 cooldown or 23505 no longer suppresses V2 evaluation.

Only these V1 lines move: the session/volatility computation and the profile call are hoisted above the policy returns, and observation writes are added. The V1 arguments, ordering of the V1 dedup check, insert payload, alert fan-out and return values are unchanged.

## C. Evaluation vs publication, recorded separately

`model_observations.decision` (evaluation outcome, per model):
`candidate` | `no_trade` | `insufficient_data` | `model_error` | `mean_reversion_candidate`.

`model_observations.disposition` (policy outcome, per model):
`published` | `cooldown_suppressed` | `db_duplicate` | `not_applicable` (V2 never publishes) | `research_enrolled` | `research_cooldown_suppressed` | `none`.

Two independent axes: a V2 `candidate` with `research_cooldown_suppressed` and a V1 `candidate` with `cooldown_suppressed` are both fully recorded.

## D. `model_observations` (new, additive)

Columns: `id uuid pk`, `scan_run_id uuid not null`, `instrument text not null`, `model_version smallint not null`, `evaluated_at timestamptz not null default now()`, `decision text not null`, `disposition text not null`, `strategy_family text null`, `quality_grade text null`, `structure_key text null`, `cooldown_eligible boolean null`, `shadow_execution_id uuid null references shadow_executions(id) on delete set null`, `signal_id uuid null references scanned_signals(id) on delete set null`, `reason text null` (model error message or no-trade reason, truncated 500), `candle_snapshot_note text null` (see §I).

`UNIQUE (scan_run_id, instrument, model_version)` — the identity requested, and the same pairing identity as `observation_key`. Writes use conditional upsert on that key so a retried job cannot double-count.

CHECK constraints on `decision`, `disposition`, `strategy_family` (`continuation` | `mean_reversion`), `quality_grade` (`A+` | `A` | `B`). RLS enabled, **no policies**, grants to `service_role` only, plus admin read through the existing `is_admin()`-gated RPC path. Retention: 180 days, matching `regime_snapshots`; deliberately not pruned on the 7-day `scan_queue` schedule, which is exactly why `scan_queue` cannot substitute for this table.

This is a decision ledger, not a replay engine: no cursors, no polling, no candle storage.

## E. Shadow execution stays trade-plan-only

A `shadow_executions` row is written only when V2 returns a **fully specified executable profile**: finite entry, stop, `tp1..tp3`, strictly positive risk distance, finite `maxR ≥ tp1_r`, and a finite ATR. `no_trade`, `insufficient_data`, `model_error` and `mean_reversion_candidate` never produce a shadow row — they exist only as observations. Migration adds `strategy_family` and `quality_grade` to `shadow_executions` (nullable, CHECKed, no default) so V1 rows are untouched.

## F. Mean reversion is observation-only

No entry, stop, target, barrier or invalidation model for counter-trend setups is specified in this prompt, and improvising one during implementation is exactly the failure mode to avoid. So: H4/H1 aligned with M15 opposed is recorded as `decision = mean_reversion_candidate`, `disposition = not_applicable`, no shadow row, no R framework, no statistics beyond a frequency count. Promotion to a replayable model requires its own prompt with a full mechanics specification.

## G. V2 continuation ABC geometry (explicit, not the V1 detector)

New module `pointc.ts`, independent of `detectAbc`. For **long**:

1. `A` = confirmed swing low pivot; `B` = confirmed swing high pivot with `B.index > A.index`; `C` established after `B.index`.
2. `B.price > A.price` (non-zero leg: `B.price - A.price > eps`).
3. `A.price < C.price < B.price` (strict).
4. `retracement = (B.price - C.price) / (B.price - A.price)` ∈ `[0.382, 0.886]`.
5. Reject unless every input is finite; reject `retracement <= 0` or `>= 1` before the band test.

**Short is the exact mirror**: `A` swing high, `B` later swing low, `A.price > B.price`, `B.price < C.price < A.price`, `retracement = (C.price - B.price) / (A.price - B.price)`, same band. Implemented by one function parameterised on direction so the two branches cannot drift.

Tests (deterministic + property, seeded `20260821`): chronology `A<B<C`; direction sign; strict C bounds; no retracement outside `(0,1)`; zero-length A→B rejected; NaN/Infinity rejected; mirrored short of any accepted long is accepted with an identical ratio.

## H. Canonical Point C — precise definition

C is the **current retracement extreme measured on confirmed bars only**: for a long, the lowest low among bars strictly after `B.index` up to and including the last bar of the snapshot that `swings()`-style confirmation treats as usable; for a short, the highest high over the same span. Chosen over "most recent confirmed pivot" because a pivot needs `lookback` bars on each side, which delays detection by up to `lookback` M15 bars and would systematically publish late; and over "any pivot in the leg" because that is ambiguous when several exist.

Confirmation/lookback rule: `A` and `B` must be fractal pivots with a symmetric window of 2 bars either side (same window as V1's `swings`), so both are confirmed at least 2 bars before the snapshot end. C requires no forward bars by construction. Lookahead proof: the function receives only the frozen snapshot array and reads no index beyond `array.length - 1`; a test asserts that grading a snapshot truncated at bar *n* equals grading the full array's state at bar *n* for every *n* in the fixture.

## I. Closed-candle semantics — characterise, do not fix

`fetchCandles` requests `/timeframes/{tf}/candles?limit=N` and sorts ascending; whether the last element is a forming bar is **not established in code** and must be determined by inspection before V2 collection starts (compare the last candle's `time` against the timeframe boundary and wall clock, on a live cycle, and record the result in `docs/CHARACTERISATION.md`).

Whatever the finding: V1 timing is **not changed in this prompt**. V1 and V2 receive the identical frozen array, so the paired experiment is unaffected by a shared bias. `model_observations.candle_snapshot_note` records the last-bar timestamp per timeframe and the assumption in force, so a later closed-bar correction becomes its own versioned experiment (`model_version = 3`) with the assumption change auditable.

## J. Canonical barrier with open space

Single `barrier.ts` used for both grade headroom and `maxR`, so the two can never disagree. Directional: long uses opposing structure above, short below. When no opposing H4 pivot exists (open space), the barrier is a **finite extension**: `entry ± EXTENSION_ATR × atr_h4` with `EXTENSION_ATR = 6` (a deliberate cap, not an unbounded run), and the observation records `barrier_source = 'extension'` in the reason field. `Infinity`, `NaN`, and non-positive risk distances are rejected at the module boundary and downgrade the observation to `insufficient_data` — never persisted into `maxR`, targets, DB rows or UI. Property test: for arbitrary finite inputs, `maxR` is finite, `> 0`, and `maxR × risk ≤ |barrier − entry|`.

## K. Learning stays V1-only

No `regime_stats` write, no `recompute_regime_stats` signature change, no V2 priors, no promotion, no feedback into live grading. V2 comparison statistics are computed ad hoc in the admin panel from `shadow_executions` (`model_version = 2`) joined to `model_observations`.

## L. Error isolation

The V2 block is wrapped so any throw is caught, recorded as `decision = model_error` with the message in `reason`, and swallowed thereafter. `scan_queue.result`, `scan_queue.error`, `instrument_health`, publication and alerts remain functions of V1 and the data provider alone. Test: inject a V2 throw and assert `result = 'published'`, one V1 signal, one V1 shadow enrolment, `instrument_health.available = true`, and one V2 observation with `model_error`.

## M. Race-safe V2 cooldown

Read-then-write on a keys table is not safe. Design: table `v2_structure_claims (structure_key text primary key, claimed_at timestamptz not null)` plus a `SECURITY DEFINER` RPC `claim_v2_structure(_key text, _window_minutes int)` that performs a single atomic statement —
`INSERT ... ON CONFLICT (structure_key) DO UPDATE SET claimed_at = now() WHERE v2_structure_claims.claimed_at < now() - interval` — and returns whether this caller won. Only a winning claim may insert a shadow row. Distinct table and key namespace from the live `scanned_signals` dedup index, so V2 can never affect V1 publication. Concurrency test in the DB suite: two simultaneous claims on the same key ⇒ exactly one `true`, exactly one enrolment; a claim after the window ⇒ `true` again.

## N. Truthful wording (unchanged from the previous plan)

"Confluence Score (0–100)", explicitly not a win probability; symmetry labelled diagnostic/not scored; "displacement-origin supply/demand zone"; V1 B copy drops the false H4 claim; V1 C labelled heuristic/unvalidated. UI, email, MCP descriptions and docs only — `confidence_score` and every other DB/API field name unchanged.

## O. V1 no-change proof (replaces the 48-hour equality criterion)

Frozen deterministic fixtures (existing characterisation fixtures plus the snapshot arrays they already contain) are graded before and after the refactor; V1 must produce identical trade/no-trade, grade, direction, entry, SL, TP1–3, `maxR`, pillar flags, confluence score and structure key. The existing 132-test blocking suite must stay green and `bun run verify` must exit 0. Post-deploy 48-hour telemetry is used only to spot operational anomalies (job failures, latency, health flips, alert volume collapse) — never to require equal market counts.

## P. Phasing

1. Wording corrections (V1 UI/copy only).
2. Pure V2 modules + tests: `pointc.ts`, `barrier.ts`, `grading.v2.ts`, continuous volatility transform, `atrAtIndex`. Nothing wired.
3. Migration: `model_observations`; `shadow_executions.strategy_family`/`quality_grade`; `v2_structure_claims` + `claim_v2_structure`; `shadow_engine_state.v2_enabled boolean not null default false`.
4. Pipeline restructure per §B, shipped with `v2_enabled = false`, then flipped on.
5. Admin comparison panel (V1 vs V2 by family/grade: n, filled, win-if-filled, mean R, plus the four-cell observation matrix and V2 open-row age).
6. Closed-candle characterisation note recorded in `docs/CHARACTERISATION.md`.

Promotion of V2 to production remains a separate prompt.

## Q. Required final answers

- **A.** V2 candidate discovered and persisted when V1 says no trade — **YES** (evaluation precedes all V1 policy returns; §B).
- **B.** V2 evaluated when V1 is cooldown- or 23505-suppressed — **YES** (§B, §C).
- **C.** No-trade/no-trade persisted — **YES** (`model_observations` rows for both models every cycle; §D).
- **D.** Any V2 candidate reaching feed/email/push/webhook/MCP live signals/risk execution — **NO** (V2 never writes `scanned_signals`, which is the sole source for all of those).
- **E.** V2 exception altering V1 job outcome or instrument health — **NO** (§L).
- **F.** Concurrent workers creating duplicate V2 observations or enrolments in the cooldown — **NO** (unique observation identity + atomic claim RPC; §D, §M).
- **G.** Mean-reversion rows replayed without a full trade model — **NO** (§F).
- **H.** V1 production math changed — **NO** (§O; only V1 copy strings and the hoisting of already-computed values).

## R. Residual risks

Closed-candle status is still unverified and may reveal a shared V1/V2 bias that must be characterised rather than fixed here; the `EXTENSION_ATR = 6` open-space cap is a judgement call with no data behind it and is recorded as such; at the observed ~30% fill rate, calendar time to a statistically meaningful V1-vs-V2 comparison is plausibly months; `service_role` grants on `shadow_executions` must be confirmed before the V2 insert path is written. Confidence: high on phases 1–3, moderate on phase 4 (two new boundaries, both tested), low that V2 will measurably outperform V1 — there is no evidence either way yet.
