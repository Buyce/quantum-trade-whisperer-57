# Red-team review of the baseline plan — revised plan (still no implementation)

Reviewed as if written by someone else, against HEAD re-read this turn plus fresh read-only queries. Four decisions in the first plan do not survive review; the versioning _concept_ does, its _mechanics_ do not.

## A. Plan defects discovered

**A1 — `regime_stats` primary key collision (blocking).** The PK is `(tier, regime_key)` and `recompute_regime_stats()` starts with `DELETE FROM regime_stats WHERE tier >= 0`. Adding a plain `model_version` column would (a) let a V2 row collide with its V1 twin on the PK, and (b) have the unqualified DELETE wipe V2 on every hourly pass. The column must be part of the PK and part of the DELETE predicate, or it must not go on this table at all. My plan said "additive column, no other change" — false.

**A2 — the dual-run design invented a second, duplicated engine path (blocking).** `candidate_signals` would have no enrolment trigger, no replay, no resolver and no recompute participation. `shadow_queue` is populated by a trigger on `scanned_signals` only, and `resolveShadowExecutions` reads `shadow_executions` only. So V2 candidates would have produced _zero_ labels — an unlabelled table is not a comparison. Worse, building the resolver twice is exactly the duplicated-business-logic failure the protocol asks me to hunt. **`shadow_executions.signal_id` is already nullable and 134 of 293 rows already carry NULL**, so V2 belongs in `shadow_executions` with `model_version = 2`, reusing `replaySetup`, the resolver and the recompute verbatim.

**A3 — resolver starvation (high).** `MAX_ROWS_PER_RUN = 200` in `shadow_resolve.server.ts` is a single global cap ordered by `detected_at ASC`. Only 8 rows are currently open, so this is invisible today, but a V2 cohort doubles enrolment and V1 and V2 would compete for one 200-row budget on an hourly cron. V1 — the production model, which feeds the live priors and the weekly report — must never queue behind a research cohort. Needs explicit per-version budgets with V1 first.

**A4 — in-sample leakage in the way I proposed to evaluate priors (high).** `regime_stats` is rebuilt from _all_ resolved rows, so scoring the 151 stamped `p_fill_prior` values against their own outcomes measures fit, not prediction: each signal's outcome is inside the statistic that judges it. Any prior-vs-outcome number must instead join to `regime_snapshots` with `computed_at <= detected_at` (69 runs exist, first at 2026-08-18 11:07 UTC), which means **prior calibration is only assessable for signals detected after 2026-08-18** — a much smaller, honest window. The first plan quietly implied the whole 151.

**A5 — a statistical claim of mine was under-qualified (medium).** "Win-if-filled 39/82 = 47.6%" is conditional on fill and therefore selection-biased by construction: 201 of 283 resolved rows never filled. Unconditional expectancy is `p_fill × p_win`, i.e. ~0.29 × 0.476 ≈ 0.138 win-per-signal, and the baseline document must carry both numbers side by side or the next reader will quote 47.6% as the engine's win rate. Also 84 of 283 resolved rows have `trading_session IS NULL`, so any session-sliced baseline cell is contaminated and must be reported as `unknown`, never folded into a named session.

**A6 — worker CPU/lifecycle risk I did not price (medium).** A second `buildTradeProfile` call inside `processNextJob` sits inside a 20s wall-clock budget already consumed mostly by three 8s candle fetches. Grading is pure CPU over ≤1000 candles (single-digit ms), so the risk is small — but it is non-zero, and a V2 exception must not be able to fail a V1 publish. It has to be wrapped so that any V2 throw is swallowed after V1 has committed. Zero extra MetaApi calls either way (same in-memory candle arrays), which is the one thing the original design got right.

**A7 — pairing key missing (medium).** Comparing V1 and V2 "on the same market observation" needs a join key. `scan_queue.run_id` exists but is not propagated to `scanned_signals` or `shadow_executions`, so nothing links a V1 signal to its V2 twin, and "no V1 signal but a V2 signal" (the most interesting cell) is unrepresentable.

**A8 — smaller findings.** `is_admin()` is an email literal, so an admin-only baseline table becomes unreadable if that address changes — baseline snapshots should be authenticated-read, admin-write, since they contain no PII. `claim_learning_milestone` counts gates from `regime_stats` and would need the same version filter or V2 rows would trip production milestone emails. No RLS, SSRF, alert-delivery or MCP-input change is introduced by this release; the only MCP exposure is _semantic_ (see D3).

## B. Decision-by-decision defence

**B1. Single `model_version` + registry, not six version columns.**
Alternatives: (i) six columns per component; (ii) content hash of the effective parameter set as the key. Rejected (i) because every analytical query would need six predicates and one forgotten predicate silently mixes cohorts; rejected (ii) as a key because a harmless refactor changes the hash and fragments cohorts, though the hash is worth keeping _inside_ the registry row. Evidence: the only cohort question anyone actually asks is "V1 or V2", and the registry can answer component-level questions by join. I change my mind if we ever need to A/B a single component independently of the rest — then the registry gains component rows and the row-level key becomes a composite of registry ids, not six loose columns.

**B2. V2 lives in `shadow_executions` with `model_version`, not in a new table.**
Alternatives: (i) `candidate_signals` + its own resolver (my original — see A2); (ii) V2 rows in `scanned_signals` behind a flag. Rejected (i) for duplicated replay logic and zero labels; rejected (ii) outright — `scanned_signals` inserts hit the active-unique index, the `shadow_enroll_on_signal` trigger, the feed queries and the alert fan-out, so a research row could email a user. Evidence: `signal_id` is already nullable with 134 NULLs in production, and `resolveShadowExecutions` selects purely on `status`, so V2 needs no resolver change at all. I change my mind if V2 ever needs fields the shadow table cannot hold — then a child table keyed to `shadow_executions.id`, still resolved by the same loop.

**B3. `regime_stats` keeps model_version _in its primary key_ and in the DELETE predicate; `recompute_regime_stats()` takes an explicit version argument.**
Alternatives: (i) a second table `regime_stats_v2` (rejected: forks the read path in `regime.server.ts`, `explain.ts`, `queries.ts` and the MCP tool); (ii) leave `regime_stats` V1-only and compute V2 priors on the fly (rejected: the live scanner would then do unbounded aggregation per job). Evidence: A1. I change my mind only if the recompute cost stops being a single-digit-ms scan.

**B4. Baseline is one immutable JSONB document pinned to a `regime_snapshots.run_id`, not a set of live views.**
Alternatives: (i) SQL views recomputed on demand (rejected: `purge_expired_signals()` runs hourly and has already destroyed ~68 published signals — 227 `published` queue results vs 159 surviving rows — so a "live baseline" silently changes under you); (ii) CSV export only (rejected: not queryable, no idempotency key). Evidence: the purge gap is measured, not hypothetical. Nothing would change my mind here.

**B5. Capture before any remediation, no logic change in this release.** The alternative — fix `max_R` first, since one C-grade short carries `max_r = 27.78` and resolved XAUUSD averages 20.74 — is tempting and wrong: it would rewrite the reference frame before the reference exists.

## C. Failure scenarios the architecture must survive

1. **Recompute fires mid-capture.** `recompute_regime_stats()` deletes and rebuilds `regime_stats` hourly. Capture must resolve `regime_snapshots.run_id` first and read _only_ the append-only snapshot rows for that run; it must never read `regime_stats`. Verified by design: 69 immutable runs exist.
2. **V2 floods the resolver.** 200-row global cap, V1 and V2 interleaved by `detected_at`. Mitigation: two explicit reads — V1 budget first (up to 200), V2 with whatever remains — so a V2 backlog can only delay V2. Assertion for the test matrix: with 300 open V2 rows and 5 open V1 rows, all 5 V1 rows advance in the first pass.
3. **V2 grading throws inside a live job.** Mitigation: V2 computation runs after `finish("published")`-equivalent commits, inside its own try/catch that logs and returns; a V2 failure yields "no V2 row for this observation", which the comparison reports as missing rather than treating as a no-trade.
4. **Migration rollback with V2 rows present.** Dropping `model_version` from the `regime_stats` PK while V2 rows exist would collide. Rollback order must be: delete `WHERE model_version <> 1`, then revert the function body, then drop the column. Documented as the only safe direction.
5. **Duplicate capture.** Same pinned `run_id` inserted twice — a unique constraint on `(run_id, kind)` makes the second call a no-op rather than a second "official" baseline.

## D. Revised plan

**D1 — Migration (additive, one file).**

- `model_versions(version smallint pk, label text, components jsonb, code_hash text, activated_at, retired_at, notes)`; seed V1 = today's engine with per-component hashes. Authenticated SELECT, service_role ALL.
- `model_version smallint NOT NULL DEFAULT 1` on `scanned_signals`, `shadow_executions`, `regime_snapshots`.
- `regime_stats`: add `model_version smallint NOT NULL DEFAULT 1` **and rebuild the PK as `(model_version, tier, regime_key)`**.
- `recompute_regime_stats(_model_version smallint DEFAULT 1)`: `DELETE ... WHERE model_version = _model_version AND tier >= 0`, all inserts stamped, all reads filtered by `model_version`. Same for `claim_learning_milestone`.
- `observation_key text` (nullable) on `scanned_signals` and `shadow_executions` for V1↔V2 pairing; `scan_queue.run_id || ':' || instrument`. No backfill — historical rows stay NULL and are excluded from paired analysis.
- `baseline_snapshots(id, kind text, captured_at, pinned_run_id uuid, model_version, metrics jsonb, unique(pinned_run_id, kind))`. Authenticated SELECT, service_role write.

**D2 — Baseline capture.** `src/lib/baseline/capture.server.ts` + one admin-guarded server fn. Pins the newest `regime_snapshots.run_id`, then records: resolved/filled/win counts with Wilson intervals; **both** `p_win|filled` and unconditional `p_fill × p_win`; never-filled rate and miss-distance distribution; grade × direction × instrument × session cells with `unknown` kept separate; `max_R` and stop-distance distributions; queue health (2058 jobs: 1093 no_trade, 227 published, 251 duplicate, 226 skipped, 153 failed, 85 stale, 23 legacy capped); alert and webhook dispatch counts; the reconstruction caveat that ~68 published signals are already purged. Prior calibration is a separate, clearly-labelled section restricted to signals detected after the first snapshot run (2026-08-18 11:07 UTC) and joined to the snapshot in force at detection — never to current `regime_stats`.

**D3 — Version surfacing (read-only).** `regime.server.ts`, `explain.ts`, `queries.ts` and `get_intelligence` / `get_shadow_comparison` filter on the active version and _state_ it, so no agent or panel can ever be handed a mixed cohort. Admin terminal shows active version + last capture. No user-facing copy claim changes; the Intelligence panel's "insufficient sample" wording stays true.

**D4 — Only then** the V2 shadow cohort: `buildTradeProfileV2` computed from the same candles, written to `shadow_executions` with `model_version = 2`, `signal_id = NULL`, matching `observation_key`, behind an env/registry kill switch, with the resolver's per-version budget in place. Not part of this release's acceptance.

## E. New acceptance criteria

1. Every pre-existing row in the four tables reads `model_version = 1`; `model_versions` has exactly one active row.
2. `recompute_regime_stats(1)` output is byte-identical to the last pre-migration run for the same input rows (compare against the pinned snapshot).
3. Inserting a synthetic `model_version = 2` regime row does **not** collide, and the next `recompute_regime_stats(1)` leaves it untouched — proves A1 is closed.
4. Capture run twice on unchanged data → second call is a no-op; stored metrics reproduce the ad-hoc numbers (283 resolved / 82 filled / 39 wins / 29.0% / 47.6% / 13.8% unconditional).
5. Prior-calibration section contains zero signals detected before the first snapshot run.
6. Zero change across the deployment window in published signal count, grade mix, alert count, webhook dispatches, feed contents and MCP tool outputs.
7. Rollback rehearsed in order (delete non-V1 rows → revert function → drop columns) with no error.

## F. Remaining risks, confidence, and what I cannot guarantee

Risks: the PK rebuild on `regime_stats` is the only non-trivial DDL (55 rows — brief, safe, but it is a real rewrite); 84 session-less rows permanently limit session-level baselines; ~68 purged signals are unrecoverable; the whole dataset spans ten days and one regime, so the baseline is a _reference point_, not a distribution; `is_admin()` remains an email literal.

Confidence: **high** in the migration and capture being safe and reversible (additive, one PK rebuild on a tiny table, no live-path branch, no extra broker calls); **medium** in the eventual V1-vs-V2 comparison being statistically decisive at these sample sizes; **low** in any single-cell (instrument × session × vol) estimate ever being meaningful before several hundred more resolved rows.

Cannot guarantee: that the baseline predicts future behaviour; that a corrected engine improves expectancy; that purged signals or missing session labels can be recovered; that user-reported performance means anything until real prices exist (0 of 25 trades carry `actual_entry_price`); or that the 24h vertical-barrier branch of `replaySetup` is correct in production — it has fired zero times in 283 resolutions and is only covered by unit fixtures.

**Recommendation: proceed with the revised plan (D1–D3 now, D4 as a separate approval).** The original plan's `candidate_signals` design and plain-column `regime_stats` change should be discarded.
