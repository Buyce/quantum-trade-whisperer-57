# Revised Plan — Test Infrastructure + V1 Characterization Layer (Prompt 2)

Plan only. No implementation, no migrations, no database or production behaviour changes in this turn. Scope is test infrastructure and V1 characterization **only**: no change to ABC, grade rules, confidence weights, entry, stop, targets, replay resolution, fill/TIF semantics, EV/learning formulas, alert eligibility, or risk caps.

## 1. Goal

Freeze the identity of the V1 production model in executable form before any model remediation, and put one canonical verification command behind both local/Lovable checks and GitHub Actions.

## 2. Verified current state (re-read at HEAD)

- No test framework, no test files, no `test` script. `package.json` scripts are `dev`, `build`, `build:dev`, `preview`, `lint`, `format`.
- No `.github/` directory in the working tree. Local remotes are Lovable's private git host plus an S3 mirror — **the GitHub repo `Buyce/quantum-trade-whisperer-57` is not visible from this sandbox**, so GitHub execution cannot be proven from here. It is treated as existing per your statement, and the plan is designed for it.
- Both `bun.lock` and `package-lock.json` exist. `bunfig.toml` carries the supply-chain policy (`saveTextLockfile`, `minimumReleaseAge = 86400`, `minimumReleaseAgeExcludes` for `@lovable.dev/*`).
- TS is strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noPropertyAccessFromIndexSignature`. `tsconfig.include` covers only `src/**`, `vite.config.ts`, `eslint.config.js` — tests must live under `src/` to be typechecked.
- Confirmed behaviours to be characterized (read this pass):
  - `gradeSetup` (`grading.ts:137-160`): `allAligned` requires `h4.bias !== "neutral"`; `h1m15Aligned` → **B** regardless of H4 (so H4-neutral + H1/M15 aligned yields B); `m15.bias !== "neutral"` → **C** with no mean-reversion condition.
  - `replaySetup` (`replay.ts`): the fill leg tests `touched` **before** `t > tifDeadline`, so a limit touched by a post-TIF candle still fills; stop is checked before the target ladder (conservative loss resolution); `missDistanceAtr` is populated only on the TIF-expiry path.
  - `atr()` returns **0** on insufficient data while `sma()`/`ema()` return **null**.
  - `calculateRisk` floors lots via `floorToStep`, so realized risk never exceeds the budget.
  - Whether `c_symmetry` actually moves the confidence score in `profile.ts` is **unverified** and is a Phase-0 read, not an assertion.

## 3. Test classification (mandatory label on every trading test)

| Class | Meaning | CI behaviour |
|---|---|---|
| `V1_CHARACTERIZATION` | Pins observed current production behaviour, correct or not | **Blocking** |
| `INVARIANT` | Model-independent safety property | **Blocking** |
| `INTENDED_V2` | Desired future behaviour that V1 does not satisfy | `test.todo` / report-only, **never blocking** |

Enforcement: the label is part of every test name (e.g. `[V1_CHARACTERIZATION] replay fills post-TIF touch`), `INTENDED_V2` lives in `*.v2.test.ts` files excluded from the blocking Vitest project and run by a separate report-only script. A lint-style check asserts every trading test file carries exactly one class prefix per test. CI can never fail because an `INTENDED_V2` expectation differs from V1.

## 4. V1 characterization layer (required contents)

Each item passes against current behaviour and is labelled `V1_CHARACTERIZATION`. None may be "fixed" in this prompt.

1. `replaySetup` fills a touched limit when the first touching candle is **after** TIF expiry.
2. `atr()` returns `0` on insufficient data (and `sma`/`ema` return `null`) — the divergent-convention pin.
3. H4-neutral + H1/M15 aligned still grades **B**.
4. **C** grade falls back to directional M15 with no true mean-reversion condition.
5. Symmetry's effect on confidence, pinned exactly as Phase-0 reading finds it (no-effect or weighted) — the fixture records the measured contribution rather than an assumed one.
6. ABC acceptance of invalid directional geometry / C placement, with the specific accepted-but-questionable configurations enumerated as fixtures.

Replay ambiguity fixtures, all `V1_CHARACTERIZATION`, asserting current resolution without claiming economic correctness:
- entry + stop + target inside one M15 candle (current conservative loss resolution);
- gap through the limit (fill at candle open, slippage recorded);
- post-TIF touch (item 1);
- never-filled vertical expiry;
- planned entry vs actual gap fill, including the current **planned-risk R denominator** (R measured against planned risk, not realized fill distance).

A companion `CHARACTERISATION.md` lists each pinned behaviour, why it is questionable, and that resolution belongs to the model-remediation prompt.

## 5. Blocking invariants (model-independent only)

- No `NaN`/`Infinity` in any value eligible for publication.
- Probabilities ∈ [0,1] or explicitly `null`/unavailable.
- Stop distance strictly positive.
- TP ordering monotonically profitable for the direction.
- Position-size rounding never exceeds the requested risk budget.
- Non-positive/invalid contract or tick parameters fail closed (`no_spec`/`invalid_stop`-style refusal, never a fabricated default).
- Division-by-zero paths fail closed.
- Malformed OHLC/timestamps never yield a publishable signal.

Explicitly **not** blocking: strategy-specific geometry rules and TIF ordering that V1 currently violates. Those are `INTENDED_V2`.

## 6. Framework choice

**Vitest + fast-check.** Vitest reuses the app's `@/` and `entities` aliases from `vite.config.ts`, so resolution cannot drift from production. fast-check supplies the §5 properties with seeded, bounded runs; every property run prints its seed and the seed is recorded in acceptance evidence. Rejected: `node:test` (re-implements alias/TS resolution), `bun test` (weaker Vite-config and mocking story; kept as fallback only if the 24h release guard blocks aged Vitest versions). Playwright is out of scope for this prompt.

Tests are co-located under `src/**/__tests__/` so the strict compiler options already apply.

## 7. No automatic seam phase

`metaapi.server.ts`, `webhook.server.ts` and `pipeline.server.ts` are **not** modified in this prompt. Coverage is obtained, in order, from: (a) pure exported helpers (`pineConnectorPayload`, `jsonPayload`, `describeError`, `sessionOf`, replay/grading/risk math); (b) Vitest module mocks (`vi.mock` of the fetch layer, the Supabase client module, timers via `vi.setSystemTime`); (c) fixture-driven tests; (d) DB/RPC tests. A production seam may only be **proposed** — with a named high-value test that is impossible by (a)–(d), separate review, and proof of byte-identical V1 output — never introduced as general good practice.

## 8. Database layer — evidence-driven fidelity

**Phase-0 spike first:** replay `supabase/migrations/*` onto a throwaway local Postgres and record exactly which Supabase-specific dependencies fail (`auth.users` / `auth.uid()` / `auth.jwt()`, the `private` schema with `kick_scan_worker` / `kick_shadow_worker`, extensions, enums, roles). If full replay is not clean, use the **smallest faithful schema fixture**, copying policies, indexes, constraints and RPC bodies **verbatim** from the production migrations — no paraphrasing.

Assertions, including the Prompt-00 model-version infrastructure set:

*Model versioning*
1. V1 and V2 `regime_stats` rows coexist under the composite key.
2. `recompute_regime_stats(1)` deletes/modifies no V2 row.
3. `recompute_regime_stats(2)` deletes/modifies no V1 row.
4. Regime and shadow reads return only the requested `model_version`.
5. Historical signal↔version joins never silently substitute the currently active version.
6. `scan_queue.run_id` survives `claim_scan_job` and remains usable for observation pairing.
7. Tier-0 snapshots are preserved prospectively in `regime_snapshots` (post-00D behaviour), with `vol_t1`/`vol_t2` present, and no fabricated historical Tier-0 rows.
8. Raw `baseline_snapshots` denied to `anon` and `authenticated`; reachable only through the authorized server/admin path.
9. Once defaults are removed in the expand/contract migration, an insert omitting `model_version` fails rather than silently landing in V1.

*Core integrity*
10. Per-user isolation on `executed_trades`, `scanner_settings`, `push_subscriptions`.
11. `scanned_signals_active_unique` → 23505 on a concurrent identical active signal.
12. Two concurrent `claim_scan_job` callers → exactly one claim (`FOR UPDATE SKIP LOCKED`).
13. `purge_expired_signals` retention tiers (C 24h / B 36h / A+ 48h), `taken` trades preserved, `skipped` removed.

## 9. GitHub CI

`bun run verify` is the single canonical command, identical locally and in CI, running in this order:

```text
1  bun install --frozen-lockfile     (deterministic install)
2  lint                              (eslint)
3  typecheck                         (tsgo -p tsconfig.json)
4  blocking unit + V1_CHARACTERIZATION tests
5  blocking INVARIANT tests
6  DB tests when a Postgres service is available (skipped-with-notice otherwise, never silently passed)
7  bun run build                     (production/Worker build)
```

Report-only property runs and `INTENDED_V2` are a separate `bun run verify:report` and must not make step 4–5 output nondeterministic (fixed seeds in the blocking path).

**Safe delivery of `.github/workflows/ci.yml`:** add it as a new file in an ordinary forward commit — no history rewrite, no force push, no changes to existing files beyond `package.json` scripts. `.github/` is untracked by Lovable's build and does not affect sync. `bun.lock` is canonical for the install step; `package-lock.json` is left in place and unused (out of scope). Workflow shape: `actions/checkout` → `oven-sh/setup-bun` → `bun run verify`, with a Postgres service container enabling step 6.

Reporting discipline: **"workflow file created"** and **"required check active on GitHub"** are reported as separate facts. If GitHub execution cannot be observed from the implementation environment, the second is reported as unverified — but the architecture stays CI-first, never downgraded to a permanent manual-only gate. Branch protection (require `verify` green before merge to the deploy branch) is requested from you once the check reports at least once.

## 10. Fixture provenance (mandatory)

Every committed market fixture ships a sidecar/header with: instrument; timeframe; candle time range; model version at capture; fixture schema version; source type (`synthetic` | `captured-existing-data`); known defects intentionally represented; and an assertion that it contains no secrets, tokens, or account identifiers. **No fixture collection may initiate any MetaApi/broker call** — synthetic candles or already-stored data only. A check rejects fixtures missing provenance fields.

## 11. Implementation sequence

1. **Phase 0 (spikes, nothing committed):** confirm aged installable versions of `vitest`, `@vitest/coverage-v8`, `fast-check` under the 24h guard; migration-replay spike + failure inventory; read `profile.ts` to measure symmetry's actual confidence contribution.
2. Tooling: devDeps, `vitest.config.ts` (blocking project + report-only project), `verify` / `verify:report` / `test` scripts, eslint override for test globals, test-class-label check.
3. Deterministic unit fixtures for `indicators`, `grading`, `profile`, `replay`, `risk`, `performance`, `weekly`, `regime`, `market-hours`, `versioning` — every expectation hand-calculated and class-labelled.
4. V1 characterization layer (§4) + `CHARACTERISATION.md`.
5. Blocking invariants (§5) with fixed seeds.
6. Module-mock tests for MetaApi failure modes (timeout, 401, 429, malformed candles), webhook dispatch failure modes (timeout, non-200, duplicate), job staleness and structure cooldown — **no production file edited**.
7. Database layer per §8 verdict.
8. `.github/workflows/ci.yml` per §9; report workflow-created vs check-active separately.
9. `INTENDED_V2` backlog written as `todo` tests for the model-remediation prompt.

## 12. Representative expected values

| Target | Input | Expected | Class |
|---|---|---|---|
| `atr` | 15 candles, TR = 1.0 each | 1.0 | INVARIANT-adjacent unit |
| `atr` | 10 candles, period 14 | `0` | V1_CHARACTERIZATION |
| `ema` | constant 10, any period | 10 | unit |
| `calculateRisk` | 10 000 USD, 1%, EURUSD, 50-pip stop, 100k contract | budget 100.00; riskPerLot 500; rawLots 0.20; lots 0.20; risk 100.00 | INVARIANT (never above budget) |
| `calculateRisk` | equity 0 / missing rate | `{ok:false}` with the specific reason | INVARIANT (fail closed) |
| R geometry, long | entry 1.1000, stop 1.0950, tp1 1.1050 | risk 0.0050, `tp1_r` = 1.0 | INVARIANT |
| R geometry, short | entry 1.1000, stop 1.1050, tp2 1.0900 | risk 0.0050, `tp2_r` = 2.0 | INVARIANT |
| `computeExpectancy` | R = [+2, −1, −1, +3] | mean R +0.75, win rate 0.5 | unit |
| `computeExpectancy` | empty | `EMPTY_EXPECTANCY`, no NaN | INVARIANT |
| `twoProportionZTest` | 50/100 vs 50/100 | z = 0, p = 1 | unit |
| tier with n = 10 | below `MIN_TIER_SAMPLES` 30 | verdict `insufficient` | INVARIANT |
| shrinkage | wins 1 / n 1, k = 30 | strictly between 1.0 and the prior mean | INVARIANT |
| `replaySetup` | stop+target in one candle | loss, R = −1 | V1_CHARACTERIZATION |
| `replaySetup` | post-TIF touch | fills | V1_CHARACTERIZATION |
| `gradeSetup` | H4 neutral, H1=M15 long | `B` | V1_CHARACTERIZATION |
| `gradeSetup` | H4/H1 neutral, M15 long | `C` | V1_CHARACTERIZATION |

## 13. Failure-mode simulations

MetaApi (mocked): 8s timeout → instrument flagged, job `skipped`; 401/429 → flagged, no signal; malformed candles → `no_trade`. Pipeline: `market_context` insert failure → signal rolled back, job `failed`. Concurrency: duplicate worker invocations → one claim, no double publish; stale job past `JOB_STALE_AFTER_MS` → closed without fetching. Webhook (mocked): timeout, non-200, refused, duplicate → logged, pipeline unaffected. Shadow: mid-replay provider failure → retry without corrupting `bars_replayed`/`replay_cursor`.

## 14. Baseline / versioning implications

No historical row is rewritten and no algorithm output changes; the characterization suite *is* the V1 reference. Golden outputs are stamped with `ACTIVE_MODEL_VERSION` at capture and cross-referenced to `CHARACTERISATION.md`, so a V2 diff reads as intentional divergence rather than a silent pass.

## 15. Security

No secret reaches CI: no `SUPABASE_SERVICE_ROLE_KEY`, DB password, `METAAPI_TOKEN`, VAPID keys, or `CRON_SECRET`. DB tests use only the ephemeral local instance. `minimumReleaseAge` stays intact. RLS assertions become permanent regression cover. Noted as findings for a separate hardening plan (not touched here): `webhook.server.ts` calls `fetch(target.url, …)` with no scheme/host validation, and its "secret" is a plaintext body field rather than an HMAC over the payload.

## 16. Acceptance criteria — exact evidence required

The implementation report must contain: exact files changed; exact commands run; test counts pass/fail/todo split by class; property-test seeds; database-test results per §8 item; full lint, typecheck and build output; GitHub workflow status reported separately as *file created* vs *required check active*; proof of zero MetaApi calls (no network egress from the suite; fixtures synthetic or previously stored); and a diff review showing no unintended production algorithm change. Plus: `bun run verify` exits 0; every trading test carries exactly one class label; `CHARACTERISATION.md` covers all six §4 items plus the replay ambiguity set; every fixture has complete provenance; no migration applied and no production row written.

## 17. Rollback

Delete added test files, `vitest.config.ts`, the workflow file, and remove devDeps and the added scripts. No schema or data change to undo; no production module edited (unless a seam is separately approved, in which case that single file reverts alone).

## 18. Remaining risks and what cannot be guaranteed

Node/Bun passes do not prove workerd behaviour — `bun run build` stays the only Worker-shaped check. Local Postgres RLS may differ from the managed project in roles/extensions. GitHub execution cannot be observed from this environment, so *check-active* will be reported as unverified until it reports. Migration-replay fidelity is unknown until the Phase-0 spike. Property testing cannot prove absence of latent geometry bugs. Characterizing a defect does not make it safe — it makes it reproducible, and each pinned item still needs the model-remediation prompt.

## 19. Recommendation

**Proceed** with this revised scope: CI-first via `bun run verify` in GitHub Actions, a formal three-class test taxonomy, a mandatory V1 characterization layer, blocking model-independent invariants only, no automatic production seams, evidence-driven DB fidelity, and full fixture provenance. Nothing in this prompt changes trading behaviour.
