# Automated Testing & CI System for P-Trades Hub

Plan only. No code, migrations, or database changes in this turn.

## 1. Actual goal

Before any trading-mathematics correction, P-Trades needs a regression harness that can prove a change did not alter signals, grades, fills, R, expectancy, risk output, or MCP/API semantics. The suite is the precondition for future model work, not a cosmetic addition.

## 2. Current implementation discovered (verified at HEAD)

- `package.json` has scripts `dev`, `build`, `build:dev`, `preview`, `lint`, `format`. There is **no** `test` script and no test framework in `devDependencies` (no vitest, no fast-check, no playwright).
- No test files exist anywhere in `src` (searched for `describe(`/`it(`/`vitest`; only unrelated matches such as `.limit(` in query files).
- No `.github/` directory exists, so there is currently no GitHub Actions workflow and no status check. Nothing about CI can be claimed as existing today.
- **Two lockfiles are present**: `bun.lock` and `package-lock.json`. `bunfig.toml` is Bun-specific and encodes a real supply-chain policy: `saveTextLockfile = true`, `minimumReleaseAge = 86400`, plus an explicit `minimumReleaseAgeExcludes` list for `@lovable.dev/*` packages. `package.json` also carries a `pnpm.overrides` block pinning `entities` to 4.5.0, mirrored by hard aliases in `vite.config.ts`.
- TypeScript is strict and unusually sharp: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noPropertyAccessFromIndexSignature`, `noFallthroughCasesInSwitch`. `include` covers only `src/**`, `vite.config.ts`, `eslint.config.js` — a `tests/` directory outside `src` would not be typechecked as configured.
- Build is `@lovable.dev/vite-tanstack-config` + nitro targeting Cloudflare Workers; server code must stay Worker-compatible.
- Pure, dependency-free modules already exist and are directly unit-testable: `src/lib/scanner/indicators.ts`, `grading.ts`, `profile.ts`, `src/lib/execution/replay.ts`, `src/lib/risk.ts` (`calculateRisk`, `conversionRate`, `CONTRACT_SPECS`), `src/lib/performance.ts` (`computeExpectancy`, `heatMap`, `rDistribution`), `src/lib/reports/weekly.ts` (`twoProportionZTest`, `normalTwoSidedP`, `tierStats`, `buildReport`, `median`, `isoWeekKey`), `src/lib/learning/regime.ts`, `src/lib/market-hours.ts`, `src/lib/versioning.ts`.
- Server-only logic that needs seams rather than direct import: `pipeline.server.ts`, `metaapi.server.ts`, `shadow_worker.server.ts`, `shadow_resolve.server.ts`, `alerts.server.ts`, `webhook.server.ts`, `regime.server.ts`, `capture.server.ts`.
- 12 MCP tools under `src/lib/mcp/tools/` all follow the same `defineTool` + `ctx.isAuthenticated()` shape.
- Database surface: ~24 tables, `claim_scan_job` / `claim_shadow_job` / `recompute_regime_stats` / `purge_expired_signals` / `is_admin` / `has_role`-style security-definer functions, plus the partial unique index `scanned_signals_active_unique` and the shadow-enrolment trigger.

## 3. Files/areas affected by this work

New: `vitest.config.ts`, `tsconfig.test.json` (or extending `include`), `src/**/__tests__/*.test.ts` (co-located so strict TS applies), `tests/db/*.sql` for database assertions, `.github/workflows/ci.yml`, `scripts/` helpers. Modified: `package.json` (scripts + devDeps), `eslint.config.js` (test globals/overrides), possibly small **seam-only** refactors so `webhook.server.ts` and `metaapi.server.ts` accept an injectable `fetch`. No trading formula is touched by this plan.

## 4. Confirmed defects (found in this audit)

1. **Zero automated tests** on a platform whose outputs are money decisions. Every past defect (H4-highs-only barrier bug, replay in-progress-bar/gap-through fill bug, `instrument_health` column mismatch, Mean R inconsistency) is currently unprotected against reintroduction.
2. **Dual lockfiles.** `bun.lock` and `package-lock.json` coexist, so CI and Lovable can resolve different trees. This alone can make a "frozen install" meaningless.
3. **No URL validation before webhook dispatch.** `dispatchOne` in `webhook.server.ts` calls `fetch(target.url, …)` with whatever the user stored — no scheme allowlist, no rejection of internal/loopback/link-local hosts. Worker egress limits the blast radius, but this is a genuine SSRF-shaped surface and must have tests the day it is hardened.
4. **Webhook "secret" is a plaintext body field, not a signature.** `jsonPayload` embeds `secret`; there is no HMAC over the body and no timestamp, so a receiver cannot verify integrity or reject replays. Test design must not assert a security property that does not exist yet — this is listed as a finding, not silently fixed here.
5. **Tests directory outside `src` would escape typechecking** given the current `tsconfig.include`.

## 5. Hidden / secondary risks

- Worker runtime divergence: tests run on Node/Bun, production on workerd. A test suite that passes proves math, not Worker compatibility — `bun run build` remains the only Worker-shaped gate.
- Adding devDependencies interacts with `minimumReleaseAge = 86400`: a brand-new vitest release will be refused by Bun install until 24h old. Pin known-aged versions.
- Database tests need a Postgres instance. Lovable Cloud offers no Supabase dashboard/CLI link-up and the service-role key and DB password are not retrievable here, so **CI cannot connect to the production project**. Database tests must run against an ephemeral local Postgres in CI with migrations replayed from `supabase/migrations`.
- Property tests on ABC geometry can surface *existing* algorithm behaviour as a "failure". Any such finding is a report item, never an in-place formula edit under this plan.
- E2E signup/login needs real auth; agent registration is public but creating accounts in production from CI is unacceptable. E2E is scoped to preview/local with disposable accounts, or deferred.

## 6. Alternative approaches

**A. Framework: Vitest vs Node's built-in test runner**
- Vitest — benefits: reuses `vite.config.ts` resolution including the `@/` alias and the `entities` aliases, TS out of the box, `vi.mock` for server seams, coverage via v8, browser-free jsdom option for the few component tests. Drawbacks: extra devDeps, must be version-pinned against the 24h guard. Complexity: low.
- `node:test` — benefits: zero deps. Drawbacks: no `@/` alias resolution without a loader, weak mocking, awkward TS. Complexity: deceptively higher.
- **Recommend Vitest.** Alias parity with the app is the deciding factor; `@/` appears in nearly every module.

**B. Property testing: fast-check vs hand-written table tests only**
- fast-check — benefits: this is exactly the domain (geometric invariants, probability ranges, monotonicity, "risk never rounds above budget") where generators find the cases humans miss; shrinking gives minimal reproductions. Drawbacks: one more dep, needs seeded runs (`fc.configureGlobal({ seed })`) to stay deterministic in CI, can be slow if generators are careless.
- Table tests only — benefits: fully deterministic. Drawbacks: tests only the cases we already thought of; the historical fill-detection bug was precisely an unthought-of case.
- **Recommend fast-check, seeded, bounded `numRuns`.**

**C. Database testing: local Postgres + migration replay vs pgTAP vs skip**
- Local Postgres in CI service container, replay `supabase/migrations` in order, then run assertion SQL as distinct roles (`anon`, `authenticated` with a JWT claim set, `service_role`). Benefits: real RLS/grant/index/trigger semantics, no production access, catches "migration no longer applies from scratch". Drawbacks: needs role/JWT-claim scaffolding to emulate `auth.uid()`; `auth` schema objects referenced by FKs must be stubbed.
- pgTAP — benefits: expressive assertions. Drawbacks: another extension plus a second assertion vocabulary; the value here is mostly plain `SELECT` + expected rows.
- Skip DB tests — rejected: RLS and the active-signal unique index are load-bearing.
- **Recommend local Postgres + migration replay, plain SQL assertions**, pgTAP only if assertions get unwieldy.

**D. E2E: Playwright now vs Playwright later**
- Now — benefits: catches route/auth regressions. Drawbacks: slowest, flakiest, needs seeded accounts, and the feed is legitimately empty much of the time under the Zero-Hallucination rule, which makes naive assertions unstable.
- Later (phase 3) — the minimum robust core is math + property + DB + build.
- **Recommend deferring Playwright to phase 3**, with a small smoke-only spec (public routes render, `/auth` renders, `/feed` redirects unauthenticated) rather than full journeys.

**E. Package manager / canonical lockfile: bun vs npm**
- `bunfig.toml` exists with a supply-chain policy and `bun.lock` is a text lockfile; the Lovable sandbox tooling is bun-first (`bun add`, `bun run`). `package-lock.json` has no corresponding config and no `pnpm`-style guard.
- **Recommend `bun.lock` as canonical**, CI installing with `bun install --frozen-lockfile`. Do **not** delete `package-lock.json` in this plan — mark it stale, confirm nothing in Lovable's own pipeline consumes it, and only then remove it in a separate, isolated change with an easy revert.

## 7. Recommended architecture

Minimum robust combination: **Vitest + fast-check + local Postgres migration-replay + existing `tsgo`/eslint/`bun run build`**, with Playwright deferred.

```text
layer 1  pure math / logic      Vitest, co-located in src/**/__tests__
layer 2  invariants             fast-check, seeded, inside layer-1 files
layer 3  seams (server units)   Vitest + injected fetch/clock/supabase double
layer 4  database               psql against ephemeral PG, migrations replayed
layer 5  build + typecheck      tsgo, bun run build (Worker shape)
layer 6  smoke E2E (phase 3)    Playwright, public routes only
```

Tests live **inside `src`** so the strict compiler options already apply. Server modules get dependency seams (optional injected `fetch`, `now()`, Supabase client) rather than deep mock plumbing.

## 8. Mathematical / statistical basis

- Two-proportion z-test and the normal CDF approximation in `weekly.ts` get fixture-pinned values, plus invariants: p in [0,1]; z = 0 when the two proportions are equal; p-value monotonically decreasing in |z|; `insufficient` verdict whenever either tier is below `MIN_TIER_SAMPLES` (30).
- Beta-binomial shrinkage in `regime.ts`: shrunk estimate must lie between the raw rate and the prior mean, and must converge to the raw rate as n grows. FACT (standard conjugate result), not hypothesis.
- Expectancy: `computeExpectancy` mean R must equal the hand-summed mean of the fixture samples exactly; empty input must return `EMPTY_EXPECTANCY`, never NaN.
- R geometry: for a long, `tpN_r = (tpN - entry) / (entry - stop)` and must be > 0; for a short the signs mirror. Stop distance > 0 always.
- Position sizing: rounding must be *toward* the risk budget, never above it — asserted as a property over random equity/risk%/price inputs.
- "No NaN/Infinity may become a published estimate" is a global property over every exported numeric function.

## 9. Database/schema changes

**None to production schema.** CI-only artifacts: a bootstrap SQL that creates the roles and a minimal `auth` shim (`auth.users`, `auth.uid()`, `auth.jwt()`) so migrations referencing them apply against a bare Postgres, plus per-test fixtures inserted and rolled back inside transactions.

## 10. Backend changes

Seam-only, behaviour-preserving:
- `metaapi.server.ts`: allow an injected fetch/timeout source so timeout, 401, 429, slow-response and malformed-candle paths are testable without network.
- `webhook.server.ts`: allow an injected fetch so timeout/non-200/duplicate dispatch are testable. URL validation is a **separate** hardening change with its own plan, not folded in here.
- `pipeline.server.ts` / `shadow_worker.server.ts`: accept an injectable clock where `Date.now()` decides staleness, so the `JOB_STALE_AFTER_MS` and `STRUCTURE_COOLDOWN_MINUTES` branches are deterministic.

## 11. Frontend changes

None required for phase 1–2. Phase 3 adds smoke specs only. No UI wording becomes false, since this plan changes no user-visible behaviour.

## 12. MCP / API implications

Per-tool tests asserting: unauthenticated calls return `isError` and leak nothing; `list_signals` honours grade/instrument filters, `limit`, ordering and active-only semantics; `update_my_settings` rejects invalid enums via `settings-validation.ts`; `log_trade_decision` / `update_trade_outcome` stamp `decision_source`/`price_source` as `agent`; `get_shadow_comparison` returns aggregates only. `.lovable/mcp/manifest.json` gets a drift check against the registered tool list.

## 13. Historical-data / versioning implications

No historical rows are rewritten. Regression fixtures are frozen JSON candle windows checked into the repo, tagged with `ACTIVE_MODEL_VERSION` at capture time, so a future model change shows up as an expected-output diff rather than a silent pass. Fixtures are captured from real broker candles already retrieved — never synthesized — and live under a test-only path so the Zero-Hallucination rule (which governs runtime data) is not weakened.

## 14. Security implications

- CI must never hold `SUPABASE_SERVICE_ROLE_KEY`, the DB password, MetaApi credentials, VAPID keys or `CRON_SECRET`. Database tests use only the ephemeral local instance.
- Add a dependency-audit step and keep `minimumReleaseAge` intact.
- RLS assertions become permanent: `baseline_snapshots` unreachable by `anon`/`authenticated`, per-user isolation on `executed_trades` / `scanner_settings` / `push_subscriptions`, shadow tables service-role-only, admin functions gated by `is_admin()`.

## 15. Performance / scalability

Target: layers 1–3 under ~30s locally. fast-check `numRuns` bounded (100 default, 500 for geometry). DB layer runs once per CI job, not per test file. Nothing runs at request time, so production performance is unaffected.

## 16. Implementation sequence

1. Add pinned devDeps (`vitest`, `@vitest/coverage-v8`, `fast-check`), `vitest.config.ts` reusing app aliases, and `test` / `test:watch` / `test:coverage` scripts. Verify Bun's 24h guard does not block the chosen versions.
2. Bring test files under typechecking (extend `tsconfig.include` or add a test tsconfig referenced by CI) and add an eslint override for test globals.
3. Layer 1: unit tests for `indicators`, `grading`, `profile`, `replay`, `risk`, `performance`, `weekly`, `regime`, `market-hours`, `versioning` — fixtures with hand-calculated expectations.
4. Layer 2: fast-check invariants for ABC geometry, target/stop sidedness, R positivity, probability bounds, finite-number guarantee, position-size rounding, TIF ordering.
5. Layer 3: seam refactors + server-unit tests for MetaApi failure modes, webhook dispatch failure modes, job staleness, cooldown/duplicate suppression, partial-write rollback in `pipeline.server.ts`.
6. Layer 4: CI Postgres service, migration replay, role/JWT shim, RLS + unique-index + `claim_scan_job` concurrency + `purge_expired_signals` retention-tier assertions.
7. Layer 5: `.github/workflows/ci.yml` — `bun install --frozen-lockfile` → lint → typecheck → unit/property → DB → build → dependency audit.
8. Regression fixtures for every historical defect listed in §4.1.
9. Phase 3 (separate approval): Playwright smoke.
10. Only after the mark-stale confirmation: remove `package-lock.json` in an isolated change.

## 17. Test matrix (representative concrete fixtures)

| # | Target | Input | Expected |
|---|---|---|---|
| 1 | `atr` | 15 candles, each true range exactly 1.0 | 1.0 |
| 2 | `atr` | fewer candles than the period | 0 (or documented unavailable) — never NaN |
| 3 | `ema` | constant series value 10, any period | 10 |
| 4 | `rsi` | monotonically rising closes | 100 (clamped), never > 100 |
| 5 | R geometry, long | entry 1.1000, stop 1.0950, tp1 1.1050 | risk 0.0050, `tp1_r` = 1.0 |
| 6 | R geometry, short | entry 1.1000, stop 1.1050, tp2 1.0900 | risk 0.0050, `tp2_r` = 2.0 |
| 7 | R geometry, degenerate | entry == stop | unavailable / rejected, no Infinity |
| 8 | `calculateRisk` | equity 10 000 USD, risk 1%, EURUSD, stop 50 pips, 100k contract | risk budget 100.00 USD; lots ≤ 0.20 (never above budget after rounding) |
| 9 | `calculateRisk` | equity 0, or missing conversion quote | `RiskUnavailable` with the specific reason |
| 10 | `computeExpectancy` | R = [+2, −1, −1, +3] | mean R = +0.75, win rate 0.5 |
| 11 | `computeExpectancy` | empty | `EMPTY_EXPECTANCY`, no NaN |
| 12 | `twoProportionZTest` | 50/100 vs 50/100 | z = 0, p = 1 |
| 13 | `twoProportionZTest` | tier n = 10 | verdict `insufficient` (below `MIN_TIER_SAMPLES` 30) |
| 14 | shrinkage | wins 1 / n 1, k = 30 | strictly between 1.0 and the prior mean |
| 15 | `replaySetup` | limit never touched within TIF | `never_filled`, `realized_r` null |
| 16 | `replaySetup` | bar gaps through the limit then hits TP | filled at limit, outcome `win` |
| 17 | `replaySetup` | bar touches both stop and TP | documented conservative resolution (loss), pinned by fixture |
| 18 | `replaySetup` | fill candle timestamped after expiry | rejected — TIF ordering invariant |
| 19 | `marketStatus` | Saturday 12:00 UTC | weekend-closed true |
| 20 | RLS | user B selects user A's `executed_trades` | 0 rows |
| 21 | RLS | `authenticated` selects `baseline_snapshots` | permission denied |
| 22 | unique index | two concurrent identical active signals | second insert → 23505 → `duplicate` |
| 23 | `claim_scan_job` | two concurrent callers, one pending job | exactly one claim |
| 24 | `purge_expired_signals` | expired C 25h / B 37h / A+ 49h old | all three deleted; fresher rows and `taken` trades retained |
| 25 | MCP `list_signals` | unauthenticated | `isError`, no rows |
| 26 | MCP `update_trade_outcome` | agent caller | `price_source = 'agent'` persisted |

## 18. Failure-mode simulations

MetaApi: 8s timeout → graceful skip + `instrument_health` flagged, job closed as `skipped`; 401 and 429 → instrument flagged, no signal written; malformed/short candle array → `no_trade`, never a partial signal. Pipeline: `market_context` insert failure → signal row rolled back, job `failed` (this is the compensating path already in code). Duplicate/concurrent worker invocations → single claim, no double publish. Stale job past `JOB_STALE_AFTER_MS` → closed without fetching. Webhook: timeout, non-200, connection refused, duplicate dispatch → logged in `webhook_dispatch_log`, pipeline unaffected. Shadow worker: mid-replay provider failure → job retried without corrupting `bars_replayed`/`replay_cursor`.

## 19. Baseline vs corrected-model comparison

This change is test-only and must produce a **byte-identical** algorithm. The baseline is the existing quantitative-integrity snapshot plus a golden-file capture: run the current pure functions over the frozen fixture set and commit the outputs. Any later model work must diff against those golden files. I will not quote signal counts, fill rates or expectancy numbers in this plan — the live tables are the source of truth and retention has already destroyed part of the early history; §4 of the existing baseline document records that caveat.

## 20. Deployment / shadow / canary

CI is additive and runs outside the runtime path, so there is no canary need. Gates: PRs require lint + typecheck + unit/property + DB + build green. Quantitative tests (layers 1–2) are **blocking**; the deferred Playwright smoke starts non-blocking for two weeks before promotion. No production deploy on a red quantitative job.

## 21. Rollback plan

Every step is revertible by deleting added files and removing devDeps; no schema or data change to undo. Seam refactors are the only production-code touch — each keeps the existing call signature with an optional injected dependency defaulting to today's behaviour, so reverting is a single-file change. `package-lock.json` removal is deliberately last and isolated so restoring it is trivial.

## 22. Acceptance criteria

`bun run test` green locally and in CI; every module in §2's pure list has at least one hand-calculated fixture; all §17 rows implemented and passing; each §4.1 historical defect has a named regression test; RLS isolation and the active-signal unique index asserted against a from-scratch migration replay; `tsgo` and `bun run build` still exit 0; a real GitHub check exists and blocks merge (only claimed once it actually reports).

## 23. Remaining uncertainties

Whether Lovable's own pipeline reads `package-lock.json` (must be confirmed before deletion). Whether the repo has a GitHub remote at all — none is configured now, so Actions may not be reachable and an alternative gate may be needed. How much `auth` schema shimming the migrations demand on a bare Postgres. Whether current ABC geometry satisfies every proposed invariant, or whether some invariants must be relaxed to describe intended behaviour.

## 24. What I cannot guarantee

That Node/Bun test passes imply workerd correctness. That local Postgres RLS behaviour is identical to the managed project's (extensions and role configuration can differ). That property tests find all latent geometry bugs — absence of counterexamples is not proof. That fixture-based tests catch defects in code paths no fixture exercises. That the webhook plaintext-secret and missing-URL-validation findings are safe to leave open; they need their own hardening plan.

## 25. Final recommendation

**Proceed, with two modifications to the brief.** (a) Do not adopt all five candidate frameworks: Vitest + fast-check + a local-Postgres SQL layer is the minimum robust combination, and Playwright belongs in a later phase as smoke-only. (b) Do not delete `package-lock.json` as part of this work — declare `bun.lock` canonical, verify Lovable's expectations, then remove it separately. Additionally, the SSRF-shaped webhook URL gap and the plaintext webhook secret are real findings that deserve their own hardening plan; this plan only builds the tests that would guard such a fix.
