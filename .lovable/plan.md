# Prompt 8 + 9 — Statistical Validation Standard and Trade-Journal Mathematics

Plan only. No code, migrations or database state changes in this turn.

## 1. Restatement of the actual goal

P-Trades must stop treating a p-value as economic proof, and must stop calling a
trade "verified" or its R "correct" when the arithmetic denominator, the price
inputs or the evidence do not support it. Two deliverables:

- **Prompt 8:** an evidence standard — interval estimates, effect sizes,
  day-clustered bootstrap for R, multiple-testing control, an experiment ledger
  and a real holdout — with cost-adjusted expected R (not win rate) as the
  primary metric.
- **Prompt 9:** correct actual-risk R mathematics, explicit input validation,
  graded verification evidence levels, and an explicit trade state machine.

## 2. Current implementation discovered (re-read at HEAD)

- `src/lib/reports/weekly.ts` — pooled two-proportion z-test, `MIN_TIER_SAMPLES = 30`,
  `verdict: significant | not_significant | insufficient`, tiers hardcoded
  `HIGH = A+/A`, `LOW = B/C`. No interval, no effect size, no multiplicity control;
  two tests are run per week and each is judged independently at p < 0.05.
- `src/lib/reports/weekly.server.ts` — correctly reads `shadow_executions_production`,
  pinned to `ACTIVE_MODEL_VERSION` and `REPLAY_V1_VERSION`. Isolation is sound.
- `src/lib/performance.ts` — `computeExpectancy` is arithmetically fine, but
  `generateInsights` emits prescriptive claims at `count >= 3`: "consider
  excluding it", "raising your minimum grade above X", "your highest-yield
  window". No uncertainty, no interval, no multiplicity, ranks best/worst on a
  point estimate of a 3-sample group.
- `src/lib/trade-journal.functions.ts` — R denominator is
  `abs(signal.entry_price - signal.stop_loss)` (**planned** risk) while the
  numerator uses **actual** entry and exit. `realized_r_multiple` is overwritten
  with this mixed number. `price_source = 'human'`.
- `src/lib/mcp/tools/update-trade-outcome.ts` — duplicates the same formula and
  the same defect independently; `price_source = 'agent'`.
- `src/lib/mcp/tools/log-trade-decision.ts` — `upsert` on `(user_id, signal_id)`
  can flip a resolved trade back to `outcome: 'open'` and wipe nothing else, with
  no state guard.
- `src/lib/user-audit.functions.ts` — verdicts `verified | unverifiable |
  contradicted | pending`; `verified` is granted for price-backed rows,
  `trustScore` = share of resolved rows **not contradicted**, so unverifiable
  rows count positively. `r_exceeds_max_r` is treated as a defect flag.
- `executed_trades` columns today: `outcome`, `realized_r_multiple`, `derived_r`,
  `actual_entry_price`, `actual_exit_price`, `price_source`,
  `price_source_client`, `price_recorded_at`, `decision_source`. No actual stop,
  no timestamps, no ticket, no costs, no legs, no verification level, no state.
- Live data (queried this turn): 25 journal rows, **19 closed self-reported**,
  **0 rows with both prices**, 181 signals, 351 resolved Replay-V1 rows of which
  **95 filled**.

## 3. Affected surface

`weekly.ts`, `weekly.server.ts`, `weekly.functions.ts`, `performance.ts` and its
tests, `routes/_authenticated/performance.tsx`, `history.tsx`,
`admin/intelligence.tsx` + `admin/AdminPanels.tsx`, `admin.functions.ts`,
`user-audit.functions.ts`, `trade-journal.functions.ts`, MCP
`update_trade_outcome` / `log_trade_decision` / `get_performance_summary` /
`list_my_trades`, `queries.ts`, `db-types.ts`, `export.ts`, RPCs
`get_admin_intelligence`, `recompute_payoff_stats`, `recompute_filter_lift`,
tables `executed_trades`, plus new `experiments` / `experiment_arms`.
Scanner, grading, replay and MetaApi paths are **not** touched.

## 4. Confirmed defects

- **D1 (mathematical, Prompt 9):** R mixes an actual-price numerator with a
  planned-price denominator. Your fixture is correct: planned 100 / stop 95 /
  actual entry 102 / exit 112 → current code returns 10/5 = **2.00R**; true
  actual initial risk is |102 − 95| = 7 → **1.4286R**. Overstated by 40%.
- **D2:** the same formula is implemented twice (server fn + MCP) and can diverge.
- **D3:** no `actual_initial_stop`. If the trader moved the stop before entry, even
  the corrected denominator is wrong and must be declared unavailable, not guessed.
- **D4:** one exit price cannot represent partial closes; any R from a scaled-out
  trade is false precision today.
- **D5:** `outcome` is user-chosen and can contradict its own R (a "win" at −0.8R).
- **D6:** input incompleteness passes silently — one price given, the other null,
  R becomes null with no error to the caller.
- **D7:** `log_trade_decision` upsert can reopen a resolved trade (no state machine).
- **D8 (statistical):** p < 0.05 on two weekly tests, no interval, no effect size,
  no multiplicity control, and the observations are not independent (overlapping
  concurrent plans on the same instrument-day).
- **D9:** prescriptive insights at n = 3.
- **D10:** B and C are pooled as one "low" tier although they are different
  quality populations.
- **D11:** win rate is presented as the headline metric.
- **D12:** `trustScore` rewards unverifiable rows; `verified` overstates evidence.

## 5. Hidden / secondary risks found

- Recomputing `realized_r_multiple` in place **destroys the historical
  self-reported series** — the only 19 closed data points. Must not be
  overwritten.
- `performance.ts` R samples feed `export.ts` (LLM export) and MCP
  `get_performance_summary`; changing R semantics silently changes both.
- `user-audit.functions.ts` `PRESET_R_VALUES` heuristic will misfire once R is
  price-derived (a genuine 2.00R becomes "preset").
- Weekly-report email template renders `z` and `pValue`; removing them without
  editing the template breaks the email.
- Bootstrap over 95 filled rows is legitimate but the day-cluster count is tiny;
  the honest output is `insufficient_clusters`, which already exists as a
  `stat_status` value in `payoff_stats`.
- Purging/embargo matters: shadow plans on the same instrument overlap in time,
  so nearby outcomes share market moves — resampling by row overstates precision.

## 6. Alternative approaches

**A. R semantics (Prompt 9 core)**

- *A1 — overwrite `realized_r_multiple` with corrected R.* Simple; destroys
  history, breaks the audit panel's contradiction logic, no rollback. **Reject.**
- *A2 — add `r_vs_plan` and `r_vs_actual_risk` as new columns, keep
  `realized_r_multiple` frozen as the legacy reported series, and make all new
  aggregates read `r_vs_actual_risk` with an explicit availability flag.*
  More columns; needs UI wording changes; fully reversible, preserves history,
  matches the shadow/dual-run doctrine. **Recommend.**
- *A3 — derive R only in views/at read time.* No write amplification, but the
  inputs (actual stop, costs) do not exist to derive from. **Reject as
  insufficient alone**; adopt its read-time discipline inside A2.

**B. Partial exits**

- *B1 — single exit price only, and refuse R when the user says they scaled out.*
  Cheap, honest, no schema sprawl.
- *B2 — `trade_legs` table with volume-weighted R now.* Correct long-term, but with
  0 priced trades there is no demand and no data to validate against.
  **Recommend B1 now, with the `trade_legs` shape specified but not built**, plus a
  `partial_exits: boolean` declaration that forces `r_availability = 'unavailable_partial'`.

**C. Statistical standard**

- *C1 — keep z-tests, add Wilson intervals.* Cheap; still equates significance
  with proof, still assumes independence. **Reject as the standard.**
- *C2 — Newcombe interval for the difference in proportions + a day-clustered
  block bootstrap interval for mean R + a declared primary metric + BH-adjusted
  q-values across the pre-registered test family + evidence levels driven by
  cluster count.* More maths, but each piece is justified by an actual defect.
  **Recommend.**
- *C3 — add CSCV / PBO.* Only meaningful with many strategy configurations. We
  have one production model and two research replays. **Defer**; the experiment
  ledger is the prerequisite that makes it possible later.

**D. Holdout**

- *D1 — random row split.* Leaks: overlapping same-day plans land on both sides.
  **Reject.**
- *D2 — time-based walk-forward with a purge/embargo gap equal to the maximum
  plan lifetime, plus a release holdout that is only read at promotion.*
  **Recommend.**

## 7. Recommended architecture

Frozen history + additive corrected columns + an evidence gate in front of every
claim, and a ledger that records how many alternatives were tried.

```text
executed_trades (frozen: realized_r_multiple, derived_r)
   + actual_initial_stop, actual_entry_at, actual_exit_at, broker_ticket,
     commission, swap, partial_exits, r_vs_plan, r_vs_actual_risk,
     r_availability, verification_level, trade_state
                 |
        shared pure module  src/lib/journal/r-math.ts
                 |  (single implementation; server fn + MCP both import it)
                 v
        stats layer  src/lib/stats/{wilson,newcombe,bootstrap,evidence,bh}.ts
                 |
   weekly report / performance insights / admin intelligence
     -> every claim carries: estimate, interval, n, cluster_n, evidence_level
```

Evidence levels (gate for all wording):
`insufficient` → `descriptive` → `suggestive` → `actionable`, driven by
cluster count and interval width, never by p alone. Prescriptive language is
allowed only at `actionable`.

Verification levels replace boolean `verified`:
`unverified` → `self_reported` → `price_backed` → `replay_consistent` /
`replay_inconsistent` → `broker_reconciled`. `replay_inconsistent` reduces the
trust metric; unverifiable rows count as neither positive nor negative.

## 8. Mathematical derivation

Actual initial risk (fail-closed): `risk = |actual_entry − stop_ref|`, where
`stop_ref = actual_initial_stop ?? signal.stop_loss`, and R is `unavailable`
if `risk <= 0`, either price is missing, or `partial_exits = true`.

- Long: `R = (exit − actual_entry − costs_in_price) / risk`
- Short: `R = (actual_entry − exit − costs_in_price) / risk`

Fixtures (hand-calculated, costs = 0):

| case | planned | stop | actual entry | exit | risk | correct R | current code |
|---|---|---|---|---|---|---|---|
| long, worse fill | 100 | 95 | 102 | 112 | 7 | **1.4286** | 2.0000 |
| long, better fill | 100 | 95 | 99 | 112 | 4 | **3.2500** | 2.6000 |
| long, stopped | 100 | 95 | 102 | 95 | 7 | **−1.0000** | −1.4000 |
| short | 100 | 105 | 98 | 90 | 7 | **1.1429** | 1.6000 |
| moved stop 97 | 100 | 95 | 102 | 112 | 5 | **2.0000** | 2.0000 (coincidence) |
| risk 0 | 100 | 100 | 100 | 110 | 0 | **unavailable** | null |

Newcombe (Wilson-based) interval is used for a difference of proportions;
mean-R intervals come from a bootstrap resampling **trading days**, not rows,
with the day count reported. BH q-values are applied across the pre-registered
family of weekly tests.

## 9. Database changes (additive only)

- `executed_trades`: `actual_initial_stop numeric`, `actual_entry_at timestamptz`,
  `actual_exit_at timestamptz`, `broker_ticket text`, `commission numeric`,
  `swap numeric`, `partial_exits boolean not null default false`,
  `r_vs_plan numeric`, `r_vs_actual_risk numeric`,
  `r_availability text not null default 'unavailable_no_prices'`,
  `verification_level text not null default 'unverified'`,
  `trade_state text not null default 'logged'`.
- CHECK constraints: both prices present or both null; `actual_exit_at >=
  actual_entry_at`; enum-style CHECKs on the three new text columns.
- New `experiments` + `experiment_arms` tables (admin/service-role only, RLS
  enabled, GRANTs to `service_role`, `SELECT` to `authenticated` denied).
- No backfill of R for existing rows: all 25 rows stay `r_availability =
  'unavailable_no_prices'` (0 rows have prices, so nothing is lost).
- Rollback: columns are additive and nullable/defaulted; forward-fix migration
  drops the new columns and tables without touching legacy data.

## 10. Backend changes

`src/lib/journal/r-math.ts` (pure, shared) becomes the only R implementation;
`trade-journal.functions.ts` and MCP `update_trade_outcome` both call it and both
write the new columns while leaving `realized_r_multiple` and `derived_r`
untouched from now on. Explicit validation errors for incomplete input. A
`trade_state` machine (`logged → taken → resolved`, `skipped` terminal) blocks
`log_trade_decision` from reopening a resolved row. New `src/lib/stats/*` modules;
`weekly.ts` gains intervals, effect sizes, BH adjustment and A+/A/B/C separate
tiers; `performance.ts` insight generator gated on evidence level;
`user-audit.functions.ts` moves to verification levels and a trust metric that
excludes unverifiable rows.

## 11. Frontend changes

Performance page: headline switches to cost-adjusted expected R with interval and
sample/cluster counts; win rate demoted to a secondary tile labelled as such.
Insights show uncertainty and drop prescriptions below `actionable`. History page
gains actual stop, timestamps, ticket and cost inputs, plus a "scaled out" toggle
that disables R. Admin intelligence panels label evidence level per row.

## 12. MCP / API implications

`update_trade_outcome` accepts `actual_initial_stop`, timestamps, ticket, costs
and `partial_exits`, and returns `r_availability` + `verification_level` instead
of a boolean `verified`. `get_performance_summary` returns expected R with
interval and evidence level, and refuses prescriptive phrasing.
`log_trade_decision` returns an explicit error when a resolved trade would be
reopened. Descriptions updated so an assistant cannot claim broker verification.

## 13. Historical data / versioning

Legacy R stays frozen and is displayed as "self-reported (legacy basis)". No
historical observation is rewritten. Shadow/replay labels are untouched, so the
learning engine, regime stats and payoff stats are unaffected by Prompt 9.

## 14. Security

New research tables are service-role only. Verification level and R are
server-computed; a client cannot assert them. Provenance columns keep the
existing human/agent split. No user ids leave the admin aggregation.

## 15. Performance / scalability

Bootstrap runs server-side on ≤ a few thousand rows with a fixed seed and an
iteration cap; weekly and admin aggregates stay inside the existing statement
timeouts.

## 16. Implementation sequence

1. `src/lib/stats/*` pure modules + unit tests (no wiring).
2. `src/lib/journal/r-math.ts` pure module + fixture tests.
3. Additive migration (columns, CHECKs, experiment tables, GRANTs).
4. Wire `trade-journal.functions.ts` and MCP `update_trade_outcome` to the shared
   module; explicit validation; state machine.
5. Weekly report: intervals, effect sizes, BH, grade separation, email template.
6. Performance insights: evidence gating and wording.
7. Admin intelligence + user audit: verification levels, trust metric.
8. Experiment ledger writes + walk-forward/holdout definition.
9. Full `bun run verify` and DB tests.

## 17. Test matrix

A unit: every fixture in section 8; Wilson at 0/0, 1/1, 5/10; Newcombe against
published examples; BH ordering. B invariants: R sign matches outcome; R
unavailable whenever an input is missing; interval contains the point estimate.
C integration: journal write → read-back → performance aggregate consistency.
D database/RLS: new tables deny `authenticated`; CHECK rejects one-sided prices;
state machine rejects reopen. E regression: the 384 existing tests stay green and
legacy `realized_r_multiple` values are byte-identical after deploy. F failure
injection: partial write between price update and level update; duplicate MCP
call; stale request; missing signal row. G E2E: log → resolve → verify →
performance → export. H shadow: corrected R computed alongside legacy R for the
same rows and compared before any headline switch.

## 18. Failure-mode simulations

Duplicate `update_trade_outcome` (idempotent, same result); concurrent human +
agent update (last write wins, provenance recorded, no mixed-source row);
`log_trade_decision` on a resolved trade (explicit error, no state change);
bootstrap with 1 trading day (`insufficient_clusters`, no interval); email send
failure (existing latch release path unchanged).

## 19. Baseline vs corrected comparison

Capture before deploy: 25 journal rows / 19 closed / 0 priced; 351 resolved
Replay-V1 rows, 95 filled; current weekly verdicts and tier counts; current
insight strings per scope; MCP `get_performance_summary` output; grade, session
and instrument distributions. **Statement of insufficiency:** with 0 priced
trades there is no data to measure the R correction's numerical impact on real
rows — the correction is proven by fixtures, and the production effect can only be
measured once priced trades exist. Weekly tiers are also below 30 filled per tier,
so no significance claim is currently supportable either way.

## 20. Deployment / shadow / canary

Ship stats modules and R module dark first. New R columns are populated in
parallel with the frozen legacy series for at least one full reporting cycle
before any headline metric switches. A `stats_standard_v2` flag governs the new
weekly wording; the experiment ledger records the switch.

## 21. Rollback

Flag off restores previous wording instantly. Forward-fix migration drops the
additive columns and the two new tables; frozen legacy columns mean no data is
lost in either direction. No execution path is involved, so no kill switch beyond
the existing scanner and enrolment flags.

## 22. Acceptance criteria

One R implementation; every fixture in section 8 passes; no legacy value mutated;
incomplete input errors explicitly; no prescriptive claim below `actionable`;
every published proportion carries a Newcombe interval and every mean R a
day-clustered bootstrap interval with cluster count; A+/A/B/C evaluated
separately; `trustScore` no longer credits unverifiable rows; `verified` removed
as a term; reopening a resolved trade is impossible; full suite green.

## 23. Remaining uncertainties

Whether traders will actually supply actual stop and costs (drives whether
`trade_legs` is ever needed); how many trading-day clusters accumulate per month;
whether `r_exceeds_max_r` should remain a flag once R is actual-risk based —
proposed reclassification to "strategy deviation", not a defect.

## 24. What I cannot guarantee

That corrected R equals broker-reported P&L (no broker reconciliation exists);
that any tier difference becomes significant (data may never support it); that
bootstrap intervals are valid at very low cluster counts — those cases return
`insufficient` by design; that self-reported prices are truthful.

## 25. Final recommendation

**Proceed with modifications** to the request: adopt the additive dual-R design
(A2) rather than correcting R in place, defer partial-exit legs (B1) and defer
CSCV/PBO until the experiment ledger has real breadth. The rest of Prompt 8 and 9
is sound and the identified R defect is real and quantified.
