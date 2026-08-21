# Red-Team Review of the Grading Plan, and Revised Plan (PLAN ONLY)

Reviewed as an outsider against HEAD. Six defects in my own plan are confirmed below, two of them fatal to it as written.

## A. Plan defects discovered

**P1 — "signal_id NULL identifies the V2 cohort" is false.** Measured at HEAD: `shadow_executions` already holds **145 rows with `signal_id IS NULL`** (tiered retention deletes the signal and the FK nulls the column) and **0 rows with `model_version <> 1`**. Any V2 identification must key on `model_version` alone. My §6 wording would have produced a cohort filter that silently swallows 145 V1 rows.

**P2 — the V2 enrolment path does not exist.** `shadow_queue.signal_id` is `NOT NULL` with an FK to `scanned_signals`, and rows only arrive via the `enroll_shadow_signal` trigger on `scanned_signals` INSERT. A V2 evaluation that never writes `scanned_signals` therefore **cannot be enqueued**. V2 must insert into `shadow_executions` directly from the scan job (status `pending`), which is fine — `shadow_resolve.server.ts` already reads non-active versions with a leftover budget — but it means the V2 write is a *second* insert inside the scan job's critical path, with its own partial-write and error-isolation requirements. My plan asserted a mechanism that isn't there.

**P3 — no dedup on the V2 cohort ⇒ statistically invalid dataset.** V1 rows exist only when a signal is published, and publication is gated by the 120-minute `structure_key` cooldown. V2 as I described it evaluates every instrument every 15 minutes, so one lingering ABC structure yields up to 8 near-identical rows per cooldown window. Those are not independent observations; fill rate and win-if-filled computed over them would be dominated by whichever structures persisted longest — textbook autocorrelation and selection distortion, in the opposite direction from V1's bias. V2 needs the same `structure_key` cooldown *and* its own cooldown table/key so it cannot collide with the live dedup index.

**P4 — the "byte-identical V1 replay over 302 resolved rows" acceptance test is impossible.** No candle history is stored anywhere in the schema (`shadow_executions` stores the plan and the outcome, not the OHLC), and fixture provenance forbids fetching new broker data for this purpose. The no-change proof must be: V1 modules untouched (diff review), the existing 132-test blocking suite green, and V1 published-signal counts/grades unchanged after deploy.

**P5 — putting `strategy_family` into `regime_stats`/`recompute_regime_stats` now is premature and risks contaminating V1 priors.** `recompute_regime_stats` deletes and rebuilds `tier >= 0` per `model_version`; adding a grouping dimension changes the shape of the **live** V1 prior table that the scanner reads each cycle, and any backfilled family value on V1 rows is a relabelling of history. V2 statistics can live entirely in ad-hoc admin queries over `shadow_executions` until promotion. Family-aware regime keys belong to the promotion prompt.

**P6 — `strategy_family`/`quality_grade` on `scanned_signals` is dead weight.** V2 never writes `scanned_signals`. Adding columns there now creates a nullable field the UI, MCP and export layer must explain, for zero benefit until promotion. Only `shadow_executions` needs the two columns.

**P7 — env-var kill switch is the wrong switch.** Unprefixed env changes require a publish to reach production, so the "kill switch" would not be usable during an incident. `shadow_engine_state` is a single-row table already read by the workers; a boolean there is flippable through the data tool in seconds.

Also confirmed as *not* problems: `shadow_resolve` already budgets production first and never lets a research-cohort read failure abort V1 resolution; the mean-reversion definition uses only detection-time values, so no lookahead; no new HTTP route ⇒ no SSRF/auth surface; MetaApi cost is unchanged because V2 reads the candles already in memory for that job.

Unverified and must be checked before writing code: whether `shadow_executions` carries an explicit `service_role` GRANT (the sandbox role cannot see other grantees' grants), and whether the scan pipeline evaluates only closed candles — the V2 Point C rule inherits whatever V1 does here, and if the forming M15 bar is included, both engines share a mild lookahead that must be characterised rather than quietly fixed.

## B. Major design decisions, re-argued

**Decision 1 — shadow V2 instead of patching grades in place.** *Why:* B is 142 of 160 signals; the H4-neutral subset that a patch would delete has **7 filled resolutions** — nowhere near enough to justify changing the live model. *Alternatives:* (a) patch in place — rejected, silently changes production on no evidence; (b) offline research script over exported data — rejected, no stored candles, so it can only ever grade the signals V1 already chose, which is exactly the selection bias we need to escape. *Evidence:* measured grade distribution and the n=7/n=33 split. *Would change my mind:* if V2 shadow rows cannot be deduplicated cleanly, a strictly offline design with newly captured, provenance-stamped candle fixtures becomes preferable to a contaminated live cohort.

**Decision 2 — family + grade taxonomy rather than a fixed A/B/C ladder.** *Why:* continuation with mandatory H4 alignment makes defect D1 structurally impossible instead of patched, and it stops one axis carrying two trading theories. *Alternatives:* (a) keep A/B/C and simply disable C — cheaper, but leaves B undefined-by-theory and throws away the mean-reversion hypothesis untested; (b) numeric quality score with no grades — rejected, `alert_min_grade`, `min_grade`, MCP `GRADE_RANK`, the weekly A/A+ vs B/C report and the `signal_grade` enum all assume ordinal tiers, so this is a large backwards-incompatible change for no measured gain. *Evidence:* the duplicate `h1m15Aligned` branches and the "mean-reversion only" card text that HEAD does not implement. *Would change my mind:* if the shadow sample shows continuation-B and mean-reversion have indistinguishable outcomes, one axis is enough.

**Decision 3 — continuous piecewise-linear volatility, pass line preserved at ratio 1.0.** *Why:* it removes the 20-point step at 1.0 while keeping the current pass/fail *set* identical, so the change is provably about smoothness, not about admitting more setups. *Alternatives:* (a) logistic — smooth but adds two unfitted parameters, i.e. overfitting with no data; (b) per-instrument percentile/rank regime — most defensible statistically but needs a rolling volatility history the scanner does not read, and would change which setups pass. *Evidence:* 302 resolved rows total, 12 signals ever passing the order-block pillar — not enough to fit anything. *Would change my mind:* ≥400 filled resolutions per family with a reliability curve showing rank beats ratio.

**Decision 4 — wording/labelling corrections ship now, on V1.** *Why:* every string I would change is currently **false** about HEAD (B claiming an H4 constraint, C claiming mean reversion, symmetry presented as scored, "Confidence %" presented as a probability). Fixing false claims is not a model change. *Alternatives:* (a) wait for promotion — rejected, users keep reading untrue explanations for weeks; (b) rename the DB columns too — rejected, `confidence_score` is consumed by MCP, export, admin RPCs and email; renaming it is a breaking API change for a cosmetic gain. *Evidence:* measured mean confluence 42.9 vs win-if-filled ≈0.50 — the number is not a calibrated probability in either direction. *Would change my mind:* nothing; this part is unambiguous.

## C. Three failure scenarios the architecture must survive

1. **V2 grading throws mid-cycle** (bad candle array, division by zero). Required: the V2 block is wrapped so the exception is logged to the job row's error field and the V1 signal insert + `market_context` insert still commit. Test: inject a throw and assert one published signal, one enrolled V1 shadow row, zero V2 rows, job `result = published`.
2. **V2 insert succeeds, V1 publish fails 23505 on the dedup index** (concurrent duplicate). Required: no orphan V2 row for a cycle whose V1 outcome was "duplicate" — otherwise the two cohorts stop being comparable. Fix: evaluate V2 *after* the V1 outcome is known and record the V1 outcome alongside it, or skip the V2 write on duplicate. Test: two concurrent workers on the same structure ⇒ exactly one V1 signal and exactly one V2 row.
3. **Shadow resolver saturates on V2 backlog.** `MAX_ROWS_PER_RUN` is shared; V1 is read first, but a large V2 backlog can still consume the leftover forever and stall V2 resolution silently. Required: V2 write volume capped by the same cooldown as V1 (P3), plus an admin metric for V2 open-row age so a stall is visible rather than inferred.

## D. Revised plan

**Phase 1 — truthful wording, V1 only (no behaviour change).**
"Confidence" → **Confluence Score (0–100)** in UI, card copy, email and landing page; `confidence_score` column and all API field names unchanged. "Order block retest" → **displacement-origin supply/demand zone**. Pattern symmetry labelled *diagnostic, not scored*. B copy stops claiming an H4 constraint; C copy stops claiming mean reversion and is labelled *heuristic, unvalidated*. Explicit note that the score is a heuristic confluence index, not a probability of profit.

**Phase 2 — baseline capture.** Use the existing `baseline_snapshots` path to freeze the descriptive V1 baseline in §E numbers plus latency, dedup, alert counts and fixed-input risk-calculator outputs. No new statistics claimed.

**Phase 3 — pure V2 modules + tests, nothing wired.** `barrier.ts` (one canonical directional barrier used for headroom *and* `maxR`), `pointc.ts` (canonical `detectAbc` C, retracement window 0.382–0.886), `grading.v2.ts` (truth table below; EMA200 unavailable ⇒ insufficient data ⇒ no trade), `atrAtIndex` in `indicators.ts`, native-timeframe ATR normalisation for zones, continuous volatility transform. Tests only — production untouched.

**Phase 4 — V2 shadow wiring, minimal and additive.** One migration adding `strategy_family text` and `quality_grade text` **to `shadow_executions` only** (nullable, CHECK on allowed values, no default), plus `v2_enabled boolean not null default false` on `shadow_engine_state` as the kill switch and `v2_structure_keys` (key text primary key, last_seen timestamptz) as the V2-only cooldown so it can never touch the live dedup index. The scan job, after the V1 outcome is known and only when `v2_enabled`, inserts at most one `shadow_executions` row with `model_version = 2`, `status = 'pending'`, the trading session and volatility index it already has in memory, and the same `observation_key` as V1. Errors are caught and logged; V1 is never blocked. `regime_stats`, `recompute_regime_stats`, `scanned_signals`, alerts, webhooks, push, email, risk and replay semantics are **not touched**.

**Phase 5 — admin comparison panel** (V1 vs V2 by family/grade: n, filled, win-if-filled, mean R, plus V2 open-row age). Read-only, admin-gated through the existing `is_admin()` path.

Promotion remains a separate prompt.

### Truth table (V2)

| H4 | H1 | M15 | at canonical C | headroom ≥2.5 ATR | 4 pillars | Output |
|---|---|---|---|---|---|---|
| bull | bull | bull | yes | yes | yes | continuation A+ |
| bull | bull | bull | yes | yes | no | continuation A |
| bull | bull | bull | no | yes | – | continuation B |
| bull | bull | bull | yes | no | – | continuation B |
| bull | bull | bull | no | no | – | no trade |
| bear | bear | bear | (mirrored) | | | mirrored |
| neutral | bull | bull | – | – | – | no trade (B today) |
| bull | neutral | bull | – | – | – | no trade |
| bull | bull | neutral | – | – | – | no trade |
| bull | bull | bear | – | – | – | mean_reversion candidate (research only) |
| bear | bear | bull | – | – | – | mean_reversion candidate (research only) |
| neutral | neutral | bull/bear | – | – | – | no trade (C today) |
| EMA200 unavailable on any TF | | | | | | insufficient data ⇒ no trade, no row |

Volatility: `v(r)=0` for r≤0; `60r` for 0<r≤1; `60+(r−1)/0.6·40` for 1<r≤1.6; `100` above. Continuous at 1.0 and 1.6; pass set unchanged (r≥1.0).

## E. New acceptance criteria

1. No V1 module edited except UI/copy strings; existing 132-test blocking suite green; `bun run verify` exits 0.
2. Published signal count, grade mix and alert volume unchanged in the 48 h after Phase 1 and Phase 4 deploys (Phase 4 with `v2_enabled = false` first).
3. V2 cohort identified **only** by `model_version = 2`; a query proving the 145 legacy `signal_id IS NULL` V1 rows are still counted as V1.
4. V2 rows obey the cooldown: no two V2 rows share a structure key within 120 minutes.
5. Injected V2 exception ⇒ V1 signal still published (test), and a V1 duplicate outcome ⇒ no orphan V2 row (test).
6. Every truth-table row covered by a passing fixture test; `insufficient data` produces no row of any kind.
7. Barrier invariant: `maxR·risk ≤ |barrier − entry|` for every V2 profile, with grade headroom using the same barrier.
8. Hand-calculated R fixtures pass: long 1.1000/1.0950, barrier 1.1200 ⇒ risk 0.0050, maxR 4.0, TPs 1.1050/1.1100/1.1150; short 1.1000/1.1050, barrier 1.0850 ⇒ maxR 3.0. Point C: A 1.1000 B 1.1100 C 1.1045 ⇒ 0.55 accepted; C 1.1095 ⇒ 0.05 rejected; C 1.0980 ⇒ 1.20 rejected. Volatility: v(0.999)=59.94, v(1)=60, v(1.3)=80, v(1.6)=100, v(2.5)=100.
9. Migration reversible: dropping the three added objects restores the prior schema; `delete from shadow_executions where model_version = 2` restores the prior data with no V1 row touched.
10. No new MetaApi request per cycle (assert V2 consumes the in-memory candles) and no new public route.

## F. Remaining risks, confidence, and what cannot be guaranteed

Risks: the V2 cooldown key may not be comparable to V1's publication gate, leaving a residual sampling difference between cohorts; H4-neutral-B remains untestable until many more fills accumulate (currently 7); a 30% fill rate means calendar time to significance is long — plausibly months, not weeks; the forming-candle question is unresolved and could reveal a shared mild lookahead in V1 that must be characterised, not quietly fixed; `service_role` grants on `shadow_executions` need verifying before the V2 insert path is written.

Confidence: **high** that Phase 1 is correct and safe (it only removes false claims); **high** that Phase 3 is safe (pure functions, no wiring); **moderate** on Phase 4 (two new failure modes at the V1/V2 boundary, both testable); **low** that the redesign will improve measured performance rather than only make labels honest — there is no evidence either way yet.

Cannot guarantee: that V2 grades trade better than V1; that removing H4-neutral B and C would not cut signal volume materially (on current data ~24% of signals); that shadow replay equals broker execution; that the V2 cohort will be free of residual selection bias; or that promotion will ever be statistically justified.

**Recommendation: proceed with the revised plan** (Phase 1 → 5), with P1–P7 treated as binding corrections to the earlier draft.
