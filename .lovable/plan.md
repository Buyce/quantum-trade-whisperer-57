# Quantitative Integrity Baseline — audit and plan (no remediation)

## 1. Restatement of the actual goal

Freeze a truthful, immutable picture of how the current engine behaves *before* any fix lands, and put a versioning architecture in place so a corrected engine can be dual-run and compared against that frozen picture on identical market observations — without changing a single live signal, alert, grade or fill label in this release.

## 2. Current implementation discovered (HEAD, re-read this turn)

- Scan cadence: `cron.job 1` (*/15) → `/api/public/cron/scan` → `enqueueScanCycle` (expire stale + one row per instrument) → `scan_queue` insert trigger `private.kick_scan_worker()` → `/api/public/worker/process` (3 jobs or 20s budget, self-chains to 8 hops) → `claim_scan_job()` → `processNextJob`.
- `processNextJob`: drops jobs older than 15 min as `stale`; fetches H4/H1/M15 sequentially (8s timeout each); `buildTradeProfile` (readTimeframe → directionalHeadroomAtr → gradeSetup → detectAbc → stop from 10-bar extreme + max(1.2×M15 ATR, 0.5×H1 ATR, spread floor) → structural entry at Point C, dynamic 0.3×ATR offset in RUNAWAY_SESSIONS behind 4 guards → `evaluate()` risk/reachability → target ladder scaled by `maxR` → `maxAcceptableEntry`); structure cooldown query; volatility index = M15 ATR / H1 ATR; advisory `priorFor` (never branches); insert into `scanned_signals` (partial unique index enforces dedup), then `market_context`, then alert fan-out.
- Shadow: trigger `shadow_enroll_on_signal` → `shadow_queue` → `/api/public/worker/shadow` snapshot into `shadow_executions`; hourly `cron.job 6` → `shadow-resolve` → `replaySetup` (limit fill incl. gap-through, stop-before-target, 24h vertical barrier) → `recompute_regime_stats()` (k=30 hierarchical shrinkage, per-instrument ATR terciles, tiers 0–3) → `regime_snapshots` append (180d) → milestone email.
- Journal/risk/MCP/admin/frontend surfaces map as previously documented and were re-read; no version identifier exists anywhere in any of them.

## 3. Files / tables / RPCs affected by *this* release

New only: one migration (`model_versions`, `baseline_snapshots`, plus a `model_version` column default 1 on `scanned_signals`, `shadow_executions`, `regime_stats`, `regime_snapshots`), `src/lib/versioning.ts`, `src/lib/baseline/capture.server.ts`, one admin-guarded read RPC. Touched for read-only display: `AdminPanels.tsx`. No change to `profile.ts`, `grading.ts`, `replay.ts`, alerts, MCP tools or the queue.

## 4. Confirmed defects and gaps (each verified by query or file read this turn)

1. **No version identity.** Zero version columns exist. Post-fix rows would be indistinguishable from pre-fix rows in the same tables — this alone blocks any remediation release.
2. **Retention already destroyed part of the record.** `scan_queue` holds 227 `published` results but `scanned_signals` holds 159 rows; `purge_expired_signals()` runs hourly. Historical grade/direction/session distribution for deleted signals is unrecoverable. Baseline capture is therefore urgent, and signal-level baseline must be reconstructed from `shadow_executions` (293 rows, which survive via nullable `signal_id`) not from `scanned_signals`.
3. **Session labels are missing on 84 of 283 resolved shadow rows** (`trading_session IS NULL`), so those rows land in the `unknown` volatility/session buckets inside `regime_stats` tier 3. Any tier-3 read is diluted by them.
4. **User-reported performance is entirely unverified**: 25 `executed_trades`, **0** with `actual_entry_price`. The 47.4% "user-reported win rate" has no auditable R behind it and must be excluded from the baseline as a performance metric (kept only as a behavioural/discipline metric).
5. **`max_R` has no ceiling.** Average `max_r` on resolved XAUUSD rows is 20.74, and one C-grade short signal carries `max_r = 27.78`. That comes from headroom to an H4 pivot divided by a small risk, with no plausibility cap. Recorded as a defect for the *next* release; not touched here.
6. **`resolved_outcome = 'expired'` count is 0 across all 283 resolved rows.** The 24h vertical barrier has never fired, meaning every filled setup resolved on a horizontal barrier. Plausible, but it means the barrier branch of `replaySetup` is untested against production data.
7. **Observation survivorship gap**: 153 `failed` + 85 `stale` jobs (~11.6% of 2058). Cycles where an instrument was never graded are invisible in any signal-count metric.
8. **Grade distribution is degenerate**: 148 B, 3 A, 5+3 C, **0 A+ ever**. Any "A/A+ vs B/C" comparison (including the weekly report) is statistically empty on the A+ side.
9. `is_admin()` hardcodes an email literal instead of a roles table — noted as a security finding, out of scope for this release.

## 5. Hidden / secondary risks

- `regime_stats` is fully deleted and rebuilt hourly (`DELETE ... WHERE tier >= 0`); only `regime_snapshots` preserves history. A baseline that reads `regime_stats` live is a moving target — it must be pinned to a specific `run_id`.
- Adding a `model_version` column with a `NOT NULL DEFAULT` is a metadata-only operation on PG11+, so no table rewrite and no lock risk on `scanned_signals`.
- `recompute_regime_stats()` aggregates *all* resolved rows. The moment V2 shadow rows exist, they would silently merge into the same priors unless the recompute filters on `model_version` — the filter must ship in the same migration as the column, before any V2 row can exist.
- Worker self-chain plus the 2-minute drain cron can run concurrently; a V2 shadow computation added later must be inside the same job transaction path, never a second independent fetch.

## 6. Alternative approaches (versioning)

**A. Six independent columns** (`strategy_version`, `pattern_version`, `grading_version`, `profile_version`, `replay_version`, `execution_version`). Benefit: component-level comparability. Drawbacks: six mutable fields to keep coherent, combinatorial explosion in every GROUP BY, and no single key to filter on; a developer forgetting one column yields silently mixed cohorts. **Rejected.**

**B. Single `model_version` integer + a `model_versions` registry** whose row carries a `components jsonb` (per-component semantic version and content hash) plus `notes`, `activated_at`, `retired_at`. One filterable key everywhere; component detail preserved in the registry rather than duplicated on millions of rows; joins give component-level slicing when needed. **Recommended.**

**C. Content hash only** (hash of the effective parameter set per row). Benefit: automatic, impossible to forget. Drawbacks: opaque keys, no ordering, no human-readable promotion story, and any harmless refactor changes the hash and fragments cohorts. Rejected as the primary key, **adopted as a field inside B's registry**.

**Dual-run alternatives:** (i) V2 writes to `scanned_signals` with a flag — rejected: it enters the dedup index, the shadow trigger and the alert fan-out. (ii) V2 runs on its own cron — rejected: different candle snapshots make the comparison non-identical. (iii) **V2 computed inside the same job from the same in-memory candles and written to a separate `candidate_signals` table with no triggers and no alert path — recommended.**

## 7. Recommended architecture

`model_versions` registry (V1 = today's engine, seeded and marked active) + `model_version smallint NOT NULL DEFAULT 1` on `scanned_signals`, `shadow_executions`, `regime_stats`, `regime_snapshots`; `recompute_regime_stats()` gains an explicit `WHERE model_version = <active>` filter; an immutable `baseline_snapshots` table holding one JSONB document per capture (metrics + the `regime_snapshots.run_id` it was pinned to + the git-describable code hash). Nothing in the live path branches on version in this release — V1 is the only version that exists.

## 8. Mathematical / statistical notes

- Baseline fill rate = filled / resolved on `shadow_executions` where `status='resolved'`: **82/283 = 29.0%**; win-if-filled = **39/82 = 47.6%**. Wilson 95% interval on win-if-filled is roughly 37%–58% — wide, and that width is the honest headline.
- Per-cell tier-3 counts are single digits in most instrument×session cells (largest cell: GBPAUD/unknown, n=33), so no per-cell fill or win rate is reportable; the baseline records counts and intervals, never point estimates below the existing 20-sample floor.
- Grade comparison A/A+ vs B/C is not computable: zero A+ signals exist and only 3 A.

## 9–11. Database / backend / frontend changes

DB: the migration described in §7 (additive only, GRANTs and RLS mirroring the sibling learning tables — authenticated SELECT on the registry, admin-only read of snapshots). Backend: `capture.server.ts` runs the read-only aggregation and inserts one `baseline_snapshots` row; invoked once via an admin-guarded server function. Frontend: a read-only "Model version / Baseline" block in the admin terminal showing the active version and the last capture timestamp. No user-facing copy changes.

## 12. MCP / API implications

No tool inputs or outputs change in this release. `get_intelligence` and `get_shadow_comparison` will gain a `model_version` field only when V2 exists; documented now so agents are never handed mixed-cohort numbers.

## 13. Historical-data implications

All existing rows become V1 by default; nothing is rewritten. Statistics that become non-comparable after remediation, and are therefore captured now and permanently frozen: fill rate, never-filled rate, miss-distance distribution, `max_R` and target reachability, grade distribution, confidence distribution, EV priors, regime shrinkage outputs, and the weekly A/A+ vs B/C comparison. Unverified user-reported R is captured as behaviour only, flagged invalid as performance.

## 14–15. Security / performance

Baseline reads run under service role inside a server function; the snapshot read RPC is `is_admin()`-gated. The aggregation scans <3k rows and runs in low tens of milliseconds. The added column costs nothing on read paths; no index changes.

## 16. Implementation sequence

1. Migration: registry + `model_version` columns + `recompute_regime_stats()` version filter + GRANTs/RLS.
2. `src/lib/versioning.ts` exporting `ACTIVE_MODEL_VERSION` and the component descriptor used to seed the registry.
3. `capture.server.ts` + admin-guarded server function; run one capture; verify the stored document against the ad-hoc queries in §8.
4. Admin read-only display.
5. Second capture 24h later to confirm the pipeline is stable and the capture is repeatable.
6. Only then open the remediation release (V2 shadow in `candidate_signals`).

## 17. Test matrix (concrete)

- `replaySetup` unit fixtures with hand-computed expectations: long fill at limit (R = +tp1R), gap-through fill at open with slippage in pips, stop-and-target in one bar → loss/-1R, no touch past TIF → `never_filled` with `missDistanceAtr = (low − entry)/atr`, vertical-barrier close-out → mark-to-market R (currently untested in production, see §4.6).
- Invariant tests: `0 <= p_* <= 1`; tier-3 shrunk value always between its raw value and its tier-2 parent; `maxR >= MIN_REACHABLE_R` for every published row; `abs(entry − stop) > 0`; `tp1R < tp2R < tp3R`.
- DB/RLS: non-admin `select from baseline_snapshots` → denied; authenticated read of registry → allowed; anon → denied.
- Regression: capture twice against unchanged data → byte-identical metric document apart from timestamps.
- Failure injection: recompute failure must leave the prior `regime_stats` snapshot intact and the capture must refuse to write rather than write partial metrics.

## 18. Failure modes simulated

MetaApi timeout mid-cycle (already produces `failed` jobs — quantified in the baseline), duplicate capture invocation (idempotency key = pinned `run_id`), concurrent recompute during capture (capture pins `run_id` first, so it reads a consistent cohort), stale worker lease (`maintain_scan_queue` reclaims), partial insert of the snapshot document (single-row insert, atomic).

## 19–21. Comparison, deployment, rollback

Comparison plan: V2 in `candidate_signals` from the identical candle array, joined to V1 on `(run_id, instrument)` so every difference is attributable to logic, not to data. Deployment is additive and needs no flag because nothing branches on version yet. Rollback: drop the two new tables and the column; `recompute_regime_stats()` reverts to its current body. No collected data is destroyed by either direction.

## 22. Acceptance criteria

Registry seeded with V1; every existing row in the four tables reads `model_version = 1`; one `baseline_snapshots` row exists whose numbers reproduce §8 exactly; recompute output unchanged versus the pre-migration run; zero change in published signals, alerts, grades or fill labels across the deployment window.

## 23–24. Uncertainties and what I cannot guarantee

I cannot reconstruct the ~68 purged signals, nor recover session labels for the 84 shadow rows that lack them. I cannot certify the current fill rate as stationary — 283 rows over ten days spans one regime, not many. I cannot guarantee that a corrected engine will improve expectancy; the baseline only makes the question answerable. And I cannot validate user-reported performance at all until real prices exist.

## 25. Final recommendation

**Proceed with the baseline + single `model_version` registry (Approach B) and the same-candle `candidate_signals` dual-run (iii).** Reject the six-column scheme. Do not begin any grading, entry, `max_R` or replay remediation until the baseline document exists and reproduces.
