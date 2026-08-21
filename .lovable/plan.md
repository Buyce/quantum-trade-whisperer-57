# Red-Team Review + Revised Plan — Automated Testing & CI for P-Trades Hub

Plan only. No code, no migrations, no database or production changes in this turn. Reviewed as an independent reviewer attempting to falsify the previous plan against current HEAD.

## A. Plan defects discovered

**A1. The CI design was built on a remote that does not exist. (Critical)**
`git remote -v` shows `origin` pointing at Lovable's private git host (`git.private.lovable-gcp.code.storage/...`) and a `secondary` S3 mirror. **There is no GitHub remote.** The previous plan's step 7 (`.github/workflows/ci.yml`), branch protection and "required GitHub check" are therefore unimplementable as written. Everything the plan called a "release gate" would have been an unrunnable YAML file. This invalidates the deployment/gating section outright.

**A2. Two test-matrix rows assert behaviour the code does not have — a trading-model change disguised as a test. (Critical)**
- Row 18 ("fill candle after expiry → rejected, TIF ordering invariant"): in `replaySetup` the fill leg checks `touched` *before* the `t > tifDeadline` check. A bar whose timestamp is past the TIF deadline **fills** if it touches the limit; the deadline is only evaluated on the not-touched branch. Shipping row 18 as a passing test would require editing fill logic, which changes fill labels, `p_fill`, regime membership and expectancy. That is model work, not test work.
- Row 2 (`atr` insufficient data → "0 or documented unavailable"): `atr()` returns **0**, while `sma()`/`ema()` return **null**. Zero ATR is a fabricated volatility reading that flows into stop buffers and the `volatility_index`. Pinning it as correct enshrines a fail-open path; changing it is a model change. Either way, a vague "0 or unavailable" expectation is not an acceptable fixture.

**A3. Property tests were mis-scoped as blocking gates.** ABC/geometry invariants written from intent will very likely fail against current behaviour (A2 is one instance already found before any test was written). If layer 2 is blocking from day one, the pressure is to "fix" the algorithm to make CI green — exactly the silent model drift the algorithm-preservation requirement forbids.

**A4. Seam refactors were understated.** Touching `metaapi.server.ts`, `webhook.server.ts` and `pipeline.server.ts` for injectable fetch/clock is production-code surgery on the alert and execution paths. Optional-parameter defaults keep behaviour identical *if* done exactly right, but under `exactOptionalPropertyTypes` and Worker bundling this is where an alert-delivery regression would come from. The previous plan treated it as trivial.

**A5. Database-layer feasibility was asserted, not verified.** Migrations reference `auth.users`, `auth.uid()`, `auth.jwt()`, a `private` schema (`private.kick_scan_worker`, `private.kick_shadow_worker`), `pg_net`/`pg_cron`-era objects and custom enums. Whether the 20+ files in `supabase/migrations/` replay cleanly onto bare Postgres with a hand-written `auth` shim is unknown. If they do not, layer 4 stalls and blocks the whole plan.

**A6. Lockfile recommendation was under-evidenced.** `bun.lock` + `bunfig.toml` is strong evidence bun is canonical, but nothing in the repo proves Lovable's own build ignores `package-lock.json`. Correct call: declare bun canonical for *our* scripts, and leave `package-lock.json` untouched, out of scope.

**A7. Golden-file baseline could import contamination.** Fixtures captured from live tables inherit whatever the current pipeline wrote, including rows produced by the pre-fix replay logic. Committing them as "golden" without stamping the capture-time model version and the known-defect list would launder old defects into the reference set.

**A8. No cost check on MetaApi.** Not a defect in the plan's content, but it was never stated: this work must make **zero** broker calls. Any fixture capture must reuse candles already fetched, never trigger new instrument scans.

## B. Major design decisions, re-argued

**B1. Vitest as the runner**
- *Why:* `@/` alias plus the `entities` aliases in `vite.config.ts` are load-bearing; reusing Vite resolution is the only low-friction option. Evidence: `@/` imports appear across almost every module.
- *Alternatives:* (1) `node:test` — zero deps, but needs a TS loader and its own alias mapping, duplicating build config. (2) Bun's built-in `bun test` — fastest, already the sandbox package manager, but its Vite-config awareness and `vi.mock`-equivalent story are weaker and it would tie the suite to one runtime.
- *Rejected because:* both re-implement resolution the app already declares.
- *Would change my mind:* if pinned Vitest versions are blocked by `minimumReleaseAge` with no aged alternative, `bun test` becomes the pragmatic pick.

**B2. fast-check, non-blocking first**
- *Why:* the domain is invariant-shaped and the known defect class is "case nobody imagined". But A2 proves invariants will surface existing behaviour as failures.
- *Alternatives:* (1) table tests only — fully deterministic, finds nothing new. (2) fast-check blocking immediately — maximum rigour, but creates pressure to edit trading math to go green.
- *Decision:* adopt fast-check, run it in a **report-only** job for the first pass; promote individual properties to blocking only after each is confirmed to describe *intended* behaviour and current code satisfies it.

**B3. Database tests: local Postgres migration replay**
- *Why:* RLS, the `scanned_signals_active_unique` partial index and `claim_scan_job`'s `FOR UPDATE SKIP LOCKED` are load-bearing and cannot be tested from application code. CI cannot reach the managed project (no service-role key or DB password available here), so local is the only option.
- *Alternatives:* (1) pgTAP — nicer assertions, extra extension and vocabulary. (2) skip DB tests, assert app-level only — cheap and wrong; a broken policy is invisible.
- *Gate:* a spike must prove migration replay works on bare Postgres before this layer is committed to (see A5).

**B4. Playwright deferred**
- *Why:* under the Zero-Hallucination rule an empty feed is a correct state, so journey assertions are inherently flaky, and real signup against production is unacceptable.
- *Alternatives:* (1) full journeys now — highest coverage, highest flake and account-pollution risk. (2) never — loses route/auth regression cover.
- *Decision:* phase 3, smoke-only, non-blocking.

**B5. CI execution venue — revised**
- *Why:* A1 kills GitHub Actions. The only reliable gate is a **local, scripted, one-command check** (`bun run verify`) plus the platform's own build check, documented as the pre-merge ritual.
- *Alternatives:* (1) add a GitHub mirror remote and run Actions there — real gating, but needs a repo the user owns and a push path; user decision, not mine to assume. (2) Claim CI and write the YAML anyway — dishonest; rejected.
- *Would change my mind:* if the user confirms a GitHub mirror exists or wants one created, the workflow file becomes worth writing immediately.

## C. Failure scenarios the architecture must survive

**S1. Property test fails on day one because current ABC/TIF behaviour differs from intent.** (Already realised: A2.) Required response: the failing property is quarantined as a *documented finding* with a `.todo`/report-only marker, and a separate model plan decides whether to change behaviour under shadow comparison. Nothing in the trading path is edited to make CI green. If the architecture cannot express "known divergence, not regression", it is wrong.

**S2. Migration replay fails on bare Postgres** (missing `auth` schema objects, `private` schema helpers, extensions). Response: layer 4 degrades to a *subset* — a hand-written schema fixture covering only the tables under test (`executed_trades`, `scanner_settings`, `push_subscriptions`, `baseline_snapshots`, `scan_queue`, `scanned_signals`) with their real policies and indexes copied verbatim. Lower fidelity, still catches RLS and unique-index regressions, and does not block layers 1–3.

**S3. A seam refactor silently breaks alert delivery.** Response: seams are added **one file per change**, each with a before/after payload equality test (`pineConnectorPayload` and `jsonPayload` byte-identical for a fixed signal), and `webhook_dispatch_log` is checked after the first live cycle. If any seam cannot be added without changing a call signature, it is dropped and that module is tested through its pure helpers only.

**S4 (bonus). Bun's 24h release guard blocks the chosen test deps.** Response: pin to versions older than 24h; never add to `minimumReleaseAgeExcludes` without asking.

## D. Revised plan

**Phase 0 — Feasibility spikes (no committed test code)**
1. Confirm aged, installable versions of `vitest`, `@vitest/coverage-v8`, `fast-check` under the 24h guard.
2. Spike migration replay onto a throwaway local Postgres; record exactly which objects need a shim. Decide layer-4 fidelity (full replay vs schema subset per S2).
3. Confirm with the user whether a GitHub mirror should exist. Until then, **no `.github/` directory is created and no CI is claimed.**

**Phase 1 — Deterministic math (blocking)**
4. Add devDeps, `vitest.config.ts` reusing app aliases, scripts `test`, `test:watch`, `verify` (`lint && typecheck && test && build`). Tests co-located under `src/**/__tests__` so the existing strict compiler options apply.
5. Fixture-pinned unit tests for `indicators`, `grading`, `profile`, `replay`, `risk`, `performance`, `weekly`, `regime`, `market-hours`, `versioning`. Every expectation is a hand-calculated number, and each test states whether it pins **intended** behaviour or **observed current** behaviour.
6. Write a `CHARACTERISATION.md` note listing observed-but-questionable behaviours found so far — `atr()` returning 0 on short series while `sma`/`ema` return null; the fill-before-TIF ordering in `replaySetup` — as findings for a future model plan, not fixes.

**Phase 2 — Invariants (report-only, then promoted individually)**
7. fast-check properties: seeded, bounded `numRuns`. Start with the ones that must hold under any model — probabilities in [0,1]; no NaN/Infinity in any published numeric; stop distance > 0; targets on the profitable side; position size never rounds above budget (already verified true: `calculateRisk` uses `floorToStep`). Geometry and TIF-ordering properties start report-only per S1.

**Phase 3 — Seams (one file per change)**
8. Injectable fetch/clock for `metaapi.server.ts`, then `webhook.server.ts`, then the clock in `pipeline.server.ts` — each with payload-equality guards from S3. Abort any seam that changes a public signature.

**Phase 4 — Database**
9. Per the phase-0 verdict: full migration replay or schema-subset fixture. Assertions: per-user isolation, `baseline_snapshots` unreachable by `anon`/`authenticated`, active-signal unique index → 23505, concurrent `claim_scan_job` → exactly one claim, `purge_expired_signals` retention tiers (C 24h / B 36h / A+ 48h) with `taken` trades preserved.

**Phase 5 — Gate**
10. Document `bun run verify` as the mandatory pre-merge command; `bun.lock` is canonical for our scripts. `package-lock.json` is **out of scope** — not deleted, not relied on. If a GitHub mirror is confirmed, the same script becomes the workflow body and the branch rule is added then.

**Phase 6 — Optional**
11. Playwright smoke, non-blocking.

Explicitly excluded: any change to ABC, grading, entry/stop/target math, replay resolution, alerts, learning formulas, schema, or RLS. Zero MetaApi calls (A8).

## E. New acceptance criteria

1. `bun run verify` exits 0 locally: lint, `tsgo -p`, tests, `bun run build`.
2. Every pure module named in D5 has at least one hand-calculated fixture, and every test is labelled *intended* or *observed*.
3. `CHARACTERISATION.md` exists and lists at minimum the two A2 items.
4. No file under `src/lib/scanner/`, `src/lib/execution/`, `src/lib/learning/` has any behavioural diff — verified by payload/output equality tests plus review of the diff.
5. Phase-3 seams: `pineConnectorPayload` and `jsonPayload` byte-identical before and after; first post-change live cycle shows no new `webhook_dispatch_log` errors.
6. Database layer asserts all six items in D9 against a from-scratch schema.
7. No `.github/` directory and no CI claim unless a real GitHub check reports.
8. No migration applied, no row written to any production table by this work.
9. Zero MetaApi requests attributable to the test suite.

## F. Remaining risks

Node/Bun passes do not prove workerd behaviour (`bun run build` stays the only Worker-shaped check). Local Postgres RLS may differ from the managed project in role/extension configuration. Property tests may keep surfacing intended-vs-actual divergence, growing the characterisation backlog faster than it can be resolved. Seam refactors remain the only production-code risk. `package-lock.json` staying in place means a future contributor could still install from the wrong tree.

## G. Confidence

**High (≈90%)** for phases 1–2: the target modules are pure, exported and dependency-free, and the two math claims I re-checked this pass held up — `calculateRisk` floors lots via `floorToStep` (so budget is never exceeded: equity 10 000 USD, 1%, EURUSD, 50-pip stop, 100k contract → riskPerLot 500, rawLots 0.20, lots 0.20, risk 100.00), and `replaySetup` resolves stop-before-target conservatively.
**Medium (≈60%)** for phase 4: gated on the unverified migration-replay spike (A5).
**Low** for any gating claim: with no GitHub remote, "release gates" are a human ritual, not enforcement, until the user decides on a mirror.

## H. What still cannot be guaranteed

That passing tests imply correct production behaviour on Cloudflare. That local RLS equals managed RLS. That property testing finds all latent geometry bugs — no counterexample is not a proof. That the invariants I proposed describe intended behaviour; A2 shows at least two do not. That the webhook plaintext-secret and missing URL/host validation findings are safe to leave open — they need their own hardening plan. That fixture capture is free of historical contamination beyond what the model-version stamp records.

## I. Recommendation

**Modify the plan — adopt the revised phasing above.** Three changes from the first version are non-negotiable: drop the GitHub Actions gate until a mirror is confirmed; make invariant tests report-only until each is validated against intended behaviour; treat the two A2 items as characterisation findings for a separate model plan rather than test failures to "fix". One open question before phase 0 starts: **do you want a GitHub mirror created so real CI gating becomes possible, or should the gate stay a local `bun run verify` ritual plus the platform build check?**
