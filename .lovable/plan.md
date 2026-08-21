# Automated Testing & CI System for P-Trades Hub

## 1. Goal
Freeze the current engine's behaviour behind executable checks so trading mathematics can be changed later with evidence, not hope. Testing infrastructure first; no trading logic changes in this work.

## 2. Current implementation (verified at HEAD)
- Zero test files exist (`*.test.*` / `*.spec.*` search: none). No test runner in `package.json` — scripts are only `dev`, `build`, `build:dev`, `preview`, `lint`, `format`.
- No `.github/` directory. `git remote origin` is Lovable's private git host, not GitHub — so GitHub Actions only runs if GitHub sync is enabled for this project.
- Both `bun.lock` and `package-lock.json` are committed. `bunfig.toml` is bun-specific (`saveTextLockfile`, `minimumReleaseAge = 86400` supply-chain guard with a per-package allowlist). Lovable's own tooling installs with bun.
- `tsconfig.json` is already strict-plus (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`). `tsconfig.include` does **not** cover a `tests/` folder yet.
- Pure, dependency-free logic already well separated and directly unit-testable: `scanner/indicators.ts`, `scanner/grading.ts`, `scanner/profile.ts`, `execution/replay.ts`, `risk.ts`, `performance.ts`, `learning/regime.ts`, `learning/explain.ts`, `reports/weekly.ts`, `market-hours.ts`, `mcp/settings-validation.ts`, `baseline/capture.server.ts` (`wilson`, quantiles), `versioning.ts`.
- Server-coupled but injectable: `webhook.server.ts` (takes a structural `Pick<SupabaseClient,"from">`), `shadow_resolve.server.ts`, `alerts.server.ts`, `cron-auth.ts` (reads `process.env` inside the function).
- 48 SQL migrations; 9 public API routes under `src/routes/api/public/`.
- Sandbox has `psql` with `PGHOST`/`SUPABASE_DB_URL` set, but **no** `supabase` CLI and **no** Docker — a local Supabase stack is not available here.

## 3. Surface affected
New: `tests/**`, `vitest.config.ts`, `package.json` scripts, `tsconfig` include, optional `.github/workflows/ci.yml`, `tests/fixtures/**`. No runtime source file changes except (optionally) exporting a pure helper that is currently module-private, and adding the SSRF guard listed in section 4 as a separate approved change.

## 4. Confirmed defects found in this re-audit
1. **No regression safety net at all.** Every trading-math change to date has been validated by inspection plus a live cycle. Nothing prevents silent reintroduction of the fixed defects (H4-highs-only barrier bug, in-progress-bar fill, gap-through fill, session-aware entry offset).
2. **`webhook_url` is never validated.** `mcp/settings-validation.ts` validates instruments, grades, currency and numerics but not `webhook_url`; `settings.tsx` saves `webhookUrl.trim() || null`; `webhook.server.ts` then `fetch()`es it server-side from the Worker. Scheme, host and private-range are unchecked — a server-side request forgery surface, and an inserted `webhook_dispatch_log` row leaks reachability. Fix is a guard plus tests, not tests alone.
3. **Webhook idempotency is unverified.** `x-ptrades-idempotency-key` is `${signal.id}-${target.userId}` — correct by construction, never asserted; a refactor could silently make retries double-fire orders.
4. **Dispatch log write is fire-and-forget** (`void Promise…then(noop,noop)`) — a permanently failing insert is invisible. Needs a test asserting the swallow is intentional plus one observability counter.
5. **Two lockfiles, no canonical one.** npm and bun can resolve different trees; CI could pass against a tree the Lovable build never uses.

## 5. Hidden / secondary risks
- Cloudflare Worker vs Node divergence: tests run on Node, production runs on workerd. Tests can prove math, not runtime compatibility — only the production build can.
- `.server.ts` modules are import-protected from client bundles; test files must import them through the same alias resolution or the suite diverges from the build graph.
- Testing against the live Cloud database would write rows into `scanned_signals` / `shadow_executions` and corrupt the just-captured integrity baseline and the learning cohort. DB tests must never point at production.
- `minimumReleaseAge = 86400` will refuse a freshly published devDependency; adding a test runner may need an allowlist entry (requires your confirmation per the file's own comment).
- Property tests on ABC geometry can fail legitimately when a hypothesis about the structure is wrong; a failing property must trigger a decision, not an automatic loosening of the property.

## 6. Alternatives

**Runner: Vitest vs Node's built-in test runner**
- Vitest — reuses `vite.config.ts` resolution (`@/*` alias, TS, `import.meta.env`), fake timers, coverage, `expect` API. Cost: one devDependency tree. 
- `node:test` — zero dependencies, but needs its own TS/alias loader and cannot resolve the Vite alias graph, so tests would drift from the build. **Rejected.**
- Recommend **Vitest**.

**Property testing: fast-check vs hand-rolled generators**
- fast-check gives shrinking, which is what makes a failed geometry invariant actionable (it reports the minimal candle set). Hand-rolled loops give a random failure with no minimal case. Recommend **fast-check**, scoped to geometry/risk/probability invariants only.

**Database/RLS tests: three options**
- (a) Supabase CLI + Docker local stack — highest fidelity, replays all 48 migrations. Not available in this sandbox; only usable in GitHub Actions. 
- (b) A dedicated **staging Supabase project** seeded by migrations, tested with `psql` + two real user JWTs. Real RLS, real grants, real `claim_scan_job` concurrency. Needs a second project and secrets.
- (c) Assertion-only SQL suite run against production with `SET ROLE` in an aborted transaction — no isolation guarantee; one mistake writes to production. **Rejected for write tests.**
- Recommend **(a) in CI when GitHub sync is on**, and until then **(b)-style read-only policy assertions** plus pure-logic tests, with write/concurrency DB tests explicitly marked "not covered" rather than faked.

**E2E: Playwright vs none**
- Playwright is already installed in this sandbox and can drive the real preview with your injected session. Recommend a **thin** suite (5–7 flows), not a broad one — every flow that touches signals must tolerate an empty feed, because zero signals is a correct state.

**Package manager: npm vs bun**
- Lovable installs with bun and `bunfig.toml` encodes bun-only policy. Recommend **`bun.lock` canonical**, `bun install --frozen-lockfile` in CI. Do **not** delete `package-lock.json` in this change — keep it one more cycle, confirm no Lovable path reads it, then remove in a follow-up.

## 7. Recommended architecture
Minimum robust combination: **Vitest + fast-check + Playwright + SQL assertions against a non-production database.** Four layers:
```text
L1 pure math + property        vitest, no I/O          runs in seconds, gates every change
L2 injected-boundary units     vitest + fake fetch/db  webhook, cron auth, resolver budget
L3 database/RLS                psql or Supabase CLI    non-production project only
L4 E2E                         Playwright              preview, empty-feed tolerant
```

## 8. Math to pin with hand-calculated fixtures
EMA/ATR/RSI on fixed 20-bar arrays; ABC geometry; R-multiples `r = (exit-entry)/(entry-stop)`; expectancy `E = mean(R)`; Wilson interval (k=3,n=10 → 0.300, CI 0.108–0.603); two-proportion z; position size `lots = (equity × risk%) / (stopPips × pipValue)` with a worked XAUUSD and EURUSD example; `p_shrunk = (k·prior + wins)/(k + n)` with k=30.

## 9–12. Schema / backend / frontend / MCP
Schema: none. Backend: none, except the section-4.2 `webhook_url` guard (allow `https:` only, reject private/link-local/loopback hosts, fail closed) if you approve it in this batch. Frontend: none. MCP: contract tests asserting each of the 12 tools' auth requirement, filter semantics, ordering, limit clamp and version stamp — no tool behaviour changes.

## 13. Historical data / versioning
No historical row is rewritten. Tests read fixtures, never production observations. DB tests are forbidden from touching `scanned_signals`, `shadow_executions`, `regime_stats` or `baseline_snapshots` in the production project.

## 14. Security
Test env vars come from CI secrets only; no secret is echoed in test names or snapshots. SSRF, cron-secret timing, RLS cross-user isolation and admin-gate tests are first-class cases. Playwright uses the injected session, never pasted credentials.

## 15. Performance
L1+L2 target under 30s total so they can gate every change. L3/L4 run on pull request and pre-release only.

## 16. Implementation sequence
1. Add Vitest + fast-check as devDependencies (confirm the `minimumReleaseAge` allowlist with you first), `vitest.config.ts` reusing the Vite alias, `tests/` added to `tsconfig.include`, scripts `test`, `test:watch`, `test:ci`, `verify` (lint + typecheck + test).
2. L1: indicators, grading, profile geometry, replay, risk, performance/expectancy, weekly stats, regime shrinkage, explain, market-hours, settings-validation, baseline `wilson`/quantiles.
3. Regression fixtures — one named test per historical defect: `barrier-h4-highs-only`, `replay-in-progress-bar`, `replay-gap-through-fill`, `session-entry-offset`, `daily-cap-unlimited`, `retention-tiers`, `version-cohort-isolation`.
4. L1 property suite (fast-check) for the invariants in your list.
5. L2: webhook payloads/idempotency/timeout/non-200/SSRF-denial with a stubbed `fetch`; `authorizeCronRequest` accept/reject/empty/wrong-length; resolver per-version budget with a stubbed db.
6. L3: RLS/isolation/queue-claim SQL suite, pointed at a non-production database.
7. L4: Playwright flows — signup, login, feed (empty and populated), settings save, decision log, history verify.
8. CI: `bun install --frozen-lockfile` → lint → typecheck → L1+L2 → L3 → build → dependency scan.

## 17. Test matrix (excerpt, concrete expectations)
| Case | Input | Expected |
|---|---|---|
| ATR | 15 bars, TR constant 2.0 | `atr = 2.0` |
| RSI | 14 up closes | `rsi = 100` |
| ATR guard | 5 bars, period 14 | `0`, never `NaN` |
| Bullish ABC | A=100 B=110 C=104 | valid; B>A, C after B, C above A |
| Malformed | B ≤ A | `detectAbc → null` |
| Long geometry | entry 104, SL 102, TP1 108 | risk 2, TP1 = +2R, SL below entry |
| Short geometry | mirrored | risk > 0, all TPs below entry |
| Never-filled | limit never touched inside TIF | `never_filled`, `realized_r` null, `ml_target_label` null |
| Gap-through | bar opens beyond limit | filled at open, not at limit |
| Post-expiry tick | touch at TIF+1min | no fill |
| Position size | 10k equity, 1%, 20-pip stop, EURUSD ($10/pip/lot) | 0.50 lots, risk ≤ $100, never rounded up |
| Max SL% breach | stop > configured max | `RiskUnavailable`, no number shown |
| Wilson | k=3, n=10 | 0.300 (0.108–0.603) |
| Wilson n=0 | k=0, n=0 | all null, no `NaN` |
| SSRF | `http://169.254.169.254/…` | dispatch refused, no fetch issued |
| Cron auth | wrong-length secret | `false`, constant-time path |
| RLS | user B reads A's trades | 0 rows |
| Queue claim | 5 concurrent `claim_scan_job` | each job claimed exactly once |

## 18. Failure-mode simulations
MetaApi timeout (8s) and 429/401; duplicate cron invocation; worker retry mid-write; two workers claiming one job; webhook 500 then success; partial insert failure after a signal is published; stale replay cursor; provider unavailable → `instrument_health` marked unavailable and the feed shows "insufficient data", never a synthesized row.

## 19. Baseline comparison
The integrity baseline document already captured (pinned to one learning run) is the before-picture. Adding tests cannot move it: after this work, re-running capture against the same pinned run must be a no-op, and L1 fixtures must reproduce the current engine's outputs exactly. Any L1 fixture that fails on day one is a real defect, to be reported and decided on — not silently corrected.

## 20. Deployment / canary
No production behaviour changes. CI gates: `verify` must pass before publish; L3/L4 advisory for one week, then blocking. The only optional runtime change (SSRF guard) ships behind a fail-closed check with the rejected URL logged to `webhook_dispatch_log`.

## 21. Rollback
Tests and CI are additive: delete `tests/`, `vitest.config.ts`, the scripts and the workflow to revert; no data implications. If the SSRF guard blocks a legitimate endpoint, revert that single module — collected data is untouched.

## 22. Acceptance criteria
`bun run verify` green; every listed regression fixture present and failing when its defect is reintroduced; property suite green over 1000 runs per property; DB suite proves cross-user isolation and exactly-once queue claims; CI blocks publish on any L1/L2 failure; canonical lockfile documented.

## 23. Open decisions I need from you
GitHub sync on/off (decides Actions vs Lovable-side gates); whether a second Supabase project may be created for L3; whether I may add the Vitest/fast-check devDependencies and the `minimumReleaseAge` allowlist entries; whether the `webhook_url` SSRF guard ships in this batch or as its own approved change.

## 24. What I cannot guarantee
That Node-run tests prove Cloudflare Worker behaviour; that fixtures capture broker microstructure (spread, slippage, weekend gaps) beyond what the shadow replay models; that current sample sizes (283 resolved shadow rows, 43% fill rate) make any win-rate claim statistically decisive; that E2E flows touching the feed are deterministic while zero signals is a valid state; or that RLS write/concurrency tests are covered before a non-production database exists.

## 25. Recommendation
Proceed, with one modification to your brief: **not all five categories at once**. Ship layers 1–2 plus the regression fixtures and CI skeleton first (highest defect-detection per unit of risk, zero production impact), then layer 3 once a non-production database exists, then layer 4. Reject the option of DB write tests against the production project outright.
