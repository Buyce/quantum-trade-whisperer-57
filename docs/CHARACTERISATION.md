# V1 Characterisation Ledger (historical)

> **Historical document.** This is the V1 behaviour ledger as captured when the
> characterisation layer was built. It is preserved deliberately and is **not**
> updated as the repository changes. Where it disagrees with the code, the code
> wins; for current documentation start at [README.md](README.md). Any count,
> command list or CI statement below is a point-in-time observation, not a
> present-tense fact — read the repository for current numbers.

The automated suite pins the behaviour of the **V1 production engine**
(`ACTIVE_MODEL_VERSION = 1`) exactly as it runs today — including behaviour that
is questionable. Pinning is not endorsement: it guarantees that V1's published
history stays reproducible and that any future change is deliberate and visible.

## Test classes

| Class                   | Blocking | Meaning                                                                               |
| ----------------------- | -------- | ------------------------------------------------------------------------------------- |
| `[UNIT]`                | yes      | Deterministic behaviour of a pure helper.                                             |
| `[V1_CHARACTERIZATION]` | yes      | Current V1 behaviour, defects included. A failure means V1 changed.                   |
| `[INVARIANT]`           | yes      | Model-independent safety property that must hold for any engine version.              |
| `[INTENDED_V2]`         | no       | Desired future behaviour. Lives only in `*.v2.test.ts`, runs in the `report` project. |

The taxonomy is enforced by `src/test/__tests__/test-taxonomy.test.ts`: an
unlabelled test title fails the build, and an `[INTENDED_V2]` label outside a
`*.v2.test.ts` file fails the build.

## Pinned V1 behaviours

1. **Intrabar order is assumed adverse.** When one M15 candle contains the entry,
   the stop and a target, `replaySetup` resolves a **loss**. M15 OHLC cannot
   reveal sequence; V1 chooses the worse ordering.
   Pinned in `src/lib/execution/__tests__/replay.test.ts`.

2. **`atr()` returns `0` when there is not enough data**, while `sma()`/`ema()`
   return `null`. A real zero-volatility reading and "unavailable" are therefore
   indistinguishable downstream, and `readTimeframe` collapses
   `barrierDistanceAtr` to `0` on short series.
   Pinned in `src/lib/scanner/__tests__/indicators.test.ts`.

3. **R uses PLANNED risk, even after a gap-through fill.** A limit filled better
   than requested still credits TP1 as exactly `1.00R`, understating the realised
   edge on gapped fills.
   Pinned in `replay.test.ts`; the intended correction is stated (non-blocking)
   in `replay.v2.test.ts`.

4. **The fill test runs before the TIF deadline test**, so a limit first touched
   after `ORDER_TIF_MINUTES` (30) still fills, provided no earlier bar closed the
   order out. Pinned in `replay.test.ts`; intended V2 rejection in
   `replay.v2.test.ts`.

5. **A neutral H4 and an opposing H4 both grade `B`** when H1+M15 agree. Absence
   of higher-timeframe trend and direct higher-timeframe conflict are not
   distinguished by V1 grading.
   Pinned in `src/lib/scanner/__tests__/grading.test.ts`.

6. **Pattern symmetry is displayed but does not affect the confidence score.**
   `scoreConfidence` reports `symmetry` in its breakdown while the score itself
   is pillar-weighted (35/25/20/20) and then multiplied by an R:R factor floored
   at `0.7`.
   Pinned in `src/lib/scanner/__tests__/profile.test.ts`.

7. **`miss_distance_atr` is only recorded on the `never_filled` path** and is
   `null` whenever ATR is unknown. Pinned in `replay.test.ts`.

8. **A negative planned risk is silently absolute-valued.** `replaySetup`
   normalises with `Math.abs`, so a sign error upstream produces a fully resolved
   row instead of a fail-closed one. Pinned in `replay.test.ts`.

9. **An infinite stop distance is accepted by `calculateRisk` and leaks `NaN`.**
   `Math.abs(entry - Infinity)` passes the `> 0` guard, lots floor to `0`, and
   `0 x Infinity` makes `riskAmount` `NaN`. No production caller supplies a
   non-finite stop today; the behaviour is pinned so a future guard is a
   deliberate change. Pinned in `src/lib/__tests__/risk.test.ts`.

## Changing a pinned behaviour

A `[V1_CHARACTERIZATION]` failure is never "just fix the test". Either:

- it is an unintended regression → fix the code; or
- it is a deliberate model change → it belongs to a V2 research cohort
  (`shadow_executions` with `model_version = 2`, `signal_id = NULL`), the
  quantitative integrity baseline is recaptured, and only then is the pin moved
  in the same change that bumps `ACTIVE_MODEL_VERSION`.

## Fixtures

Every market fixture declares provenance (instrument, timeframe, candle range,
model version, schema version, source type, known defects). No fixture may be
produced by calling MetaApi or any broker endpoint — `sourceType` is limited to
`synthetic` or `captured-existing-data`. Enforced by
`src/test/__tests__/fixture-provenance.test.ts`.

## Commands

```
bun run test          # blocking project: UNIT + V1_CHARACTERIZATION + INVARIANT
bun run test:report   # non-blocking INTENDED_V2 project
bun run lint:blocking # narrower eslint/prettier check over test sources only
bun run verify        # full lint -> typecheck -> blocking tests -> build (canonical CI command)
```

Property tests use fixed seeds (`20260821`) so any failure is reproducible.

## Repository debt at the time of writing (superseded)

When this ledger was written, repo-wide `bun run lint` reported thousands of
pre-existing Prettier formatting errors across application sources, so `verify`
linted only the test sources (`lint:blocking`) and the repo-wide lint ran as a
separate non-blocking step. That formatting debt was subsequently cleared in the
documentation/source-quality release. `bun run lint` is now a blocking part of
`bun run verify`; `lint:blocking` remains only a narrower developer convenience.

No claim is made here about any CI status check. `.github/workflows/ci.yml` is
committed; read the CI provider for its actual result.

## Pinned: `model_version` defaults to 1

Every versioned table (`scanned_signals`, `shadow_executions`, `regime_stats`,
`regime_snapshots`, `baseline_snapshots`) still declares `model_version`
`DEFAULT 1`. An insert that omits the version therefore lands silently in the V1
cohort instead of failing closed. This is pinned, not fixed: removing the
defaults is an expand/contract migration for the model-remediation prompt, at
which point the pin in `src/test/db/__tests__/model-version.db.test.ts` inverts
into a fail-closed INVARIANT. See `docs/DB-TESTS.md`.
