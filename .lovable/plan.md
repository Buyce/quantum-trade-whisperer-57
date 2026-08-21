# Approved Plan — Prompt 8 (Statistical Standard) & Prompt 9 (Journal Mathematics)

Approved by the user, with the binding corrections below folded in. No further
planning or red-team round. Approve this card to switch to build mode so the
implementation can be written.

## Binding corrections (approved, authoritative)

- **R fields:** separate canonical `r_vs_plan` and `r_vs_actual_risk`.
  `realized_r_multiple` and `derived_r` are frozen as legacy-only provenance and
  never written again. Never average mixed bases. `stop_provenance` records
  `actual_initial_stop` versus `planned_stop_fallback` explicitly.
- **Costs:** commission and swap are money, not price distance. Store unit and
  currency; compute net / cost-adjusted R only when a documented conversion to R
  exists (price-distance unit). Otherwise net R is NULL / unavailable, and no
  cost-adjusted expected R is claimed for journal or shadow samples without cost
  provenance.
- **Concurrency:** once a trade is resolved, every conflicting later mutation of
  outcome, actual prices, actual initial stop, canonical R or provenance is
  rejected at the database level. Only semantically identical idempotent retries
  pass, unless an explicit separate correction workflow is used. A human-win
  versus agent-loss race regression test is required.
- **Statistics:** the primary dependence-aware method resamples **whole UTC
  `detected_at` days**, preserving every observation inside a selected day.
  Wilson and Newcombe remain descriptive, independence-assuming diagnostics.
  `actionable` requires a predeclared comparison, adequate independent clusters,
  a practical effect threshold, the required multiplicity control **and** genuine
  forward/OOS/holdout confirmation — so with today's insufficient holdout,
  `actionable` must be unreachable.
- **Determinism:** stable total row order, explicit seeded RNG, stored method,
  method version, seed and run id. BH/q-values are diagnostic only and operate
  only on explicitly declared hypothesis families.
- **Everything else from the reviewed plan is preserved:** additive migration with
  no backfill, shared `r-math.ts`, synchronised app/MCP/admin basis, verification
  ladder, resolved-state database enforcement, experiment ledger, weekly-window
  right-censoring fix, n=3 anti-prescriptive regression, research-table RLS, no
  scanner/grading/replay/MetaApi changes, full blocking test evidence.
- **Completion evidence must separately report:** `r_vs_plan` and
  `r_vs_actual_risk` fixtures; invalid and mixed-basis cases; unresolved cost
  provenance; conflicting-resolution concurrency; whole-day cluster fixtures;
  deterministic bootstrap equality; `actionable` impossible under the current
  insufficient holdout; admin/app/MCP basis agreement; migration and DB tests;
  full `bun run verify`; and zero change to scanner output or MetaApi request
  count.

## Red-team findings that shaped this plan

I re-read HEAD and traced every consumer of the R fields. The findings below are
retained as the rationale for the design.


## A. Plan defects discovered

**P1 — "frozen legacy series" was asserted but the code already destroys it.**
`trade-journal.functions.ts:77` and `update-trade-outcome.ts:77` both write
`realized_r_multiple: derivedR` on **every** outcome update, including setting it
to `null` when prices are absent. So the legacy self-reported series is already
mutable and is already being overwritten today. "Freeze it" is not a no-op — it is
itself a behaviour change, and the current 19 closed rows contain a mixture of
button-era values and price-era nulls. The revised plan must state this and stop
writing that column, not pretend it was already immutable.

**P2 — the plan under-counted the R consumers, so a "read-time switch" would
silently change six surfaces at once.** Confirmed readers of
`realized_r_multiple`: `performance.ts:114` (all expectancy, insights, heat map),
`export.ts:168,207` (LLM export), `SignalCard.tsx:978`, `history.tsx:312`,
`queries.ts:44,66`, MCP `get_performance_summary` and `list_my_trades`,
`user-audit.functions.ts:170`, and the SQL RPC `get_admin_intelligence`
(`user_reported` block averages `realized_r_multiple` server-side). `history.tsx:384`
already prefers `derived_r ?? realized_r_multiple`. The RPC is the one the first
plan missed entirely: a TypeScript-only change leaves the admin terminal on the
old basis while the app shows the new one — two contradictory numbers on one
screen. This is a genuine backwards-incompatibility.

**P3 — mixed-basis aggregation is worse than either basis alone.** With some rows
on planned-risk R and future rows on actual-risk R, `computeExpectancy` would
average two different units. The first plan did not forbid this. It must:
aggregates have to filter by basis, and a mixed sample must be reported as
`mixed_basis` rather than averaged.

**P4 — the `PRESET_R_VALUES` heuristic becomes actively wrong, not just noisy.**
Under actual-risk R, exact 1.0000 is essentially unreachable for a non-planned
fill, so the flag becomes near-dead; but for rows where the trader filled exactly
at plan it will fire on legitimate price-backed rows. The first plan called this a
"secondary risk" — it is a defect requiring the flag to be scoped to
`r_availability = 'unavailable_no_prices'` rows only.

**P5 — `verification_level` and `trade_state` as free text with CHECKs duplicate
business logic in SQL and TypeScript.** Two ladders that can diverge. Better: a
single source of truth in a pure TS module, with the database holding only the
constraint, and one DB test asserting the TS enum equals the CHECK list.

**P6 — bootstrap seeding claim was hand-waved.** "Fixed seed" in a serverless
handler is not reproducible unless the RNG is explicit and the row ordering is
deterministic. Without a stable `ORDER BY`, the same data gives different
intervals across invocations. Needs an explicit deterministic order plus a stored
`run_id` like `payoff_stats` already does.

**P7 — BH across "the weekly family" was undefined.** Two tests per week, run
every week, is not a single family. Applying BH within one week does almost
nothing; the real multiplicity is across weeks and across the insight generator's
best/worst rankings (instrument × grade × session × day ≈ 15+ implicit
comparisons per page load). The first plan applied the correction where it barely
matters and skipped where it matters most.

**P8 — the "release holdout" is not implementable yet and the plan implied it
was.** 351 resolved Replay-V1 rows, 95 filled, and no experiment history. A
walk-forward split of 95 filled rows with a purge gap leaves validation folds too
small to decide anything. The honest design is: build the ledger and the
time-ordered split machinery now, declare every current fold `insufficient`, and
do not present holdout results until cluster counts justify it.

**P9 — no lookahead/leakage guard was specified for the day-cluster bootstrap.**
Clusters must be keyed on the plan's **detection** day, not resolution day;
keying on resolution lets a plan's outcome choose its own cluster, and
same-instrument overlapping plans must share a cluster. Also, `weekly.ts` counts
enrolment by detection but resolution can fall outside the window — a plan
detected on day 7 is counted as enrolled yet can never be resolved in-window,
which biases fill rate downward. That is a pre-existing statistical defect the
first plan did not find.

**P10 — trading-model-change check: clean.** Nothing in either prompt touches
`grading.ts`, `profile.ts`, `indicators.ts`, `pipeline.server.ts`, the replay
labellers or MetaApi. Signal count, grades, entries, stops, targets, fills, alerts
and MetaApi request volume are unchanged. `user_decision`/`outcome` writes do not
feed the learning engine (shadow labels are the only training signal). No dual-run
or model-version bump is required for Prompt 9. Prompt 8 changes only how existing
numbers are **described**, not how they are produced.

**P11 — race condition missed.** `queries.ts:118` and MCP `log_trade_decision`
both upsert on `(user_id, signal_id)`; a human and an assistant acting
concurrently can interleave a decision write and an outcome write. A CHECK cannot
express "do not reopen"; that needs a `BEFORE UPDATE` trigger or a conditional
`WHERE` predicate on the update. The first plan's "state machine in the server
function" is not enforceable against two writers.

**P12 — migration irreversibility: acceptable, with one exception.** Additive
nullable columns are reversible. But if the plan ever backfilled
`r_vs_actual_risk` from planned prices it would be unrecoverable. Query result
this turn: **0 rows have both prices**, so there is nothing to backfill and the
plan must forbid backfill outright.

No SSRF, no new auth surface, no RLS weakening found: the new research tables are
service-role only, and `user-audit.functions.ts` already gates on owner email and
returns no user ids. Alert/push/webhook delivery paths are untouched.

## B. Revised plan

### B0. Design decisions, each with the required interrogation

**Decision 1 — additive `r_vs_actual_risk` + `r_basis`, legacy column stops being
written.**
*Why:* preserves the only 19 real data points, makes the basis explicit, and is
reversible.
*Alt 1:* correct in place. Rejected — destroys history and breaks the audit
panel's contradiction detection.
*Alt 2:* compute R only at read time. Rejected — actual stop and costs do not
exist as inputs, so there is nothing to derive from.
*Evidence:* `trade-journal.functions.ts:77` proves the column is currently
overwritten; the 0-priced-rows query proves no backfill is possible.
*Changes my mind:* if the owner accepts losing the legacy series entirely, Alt 1
becomes simpler and I would take it.

**Decision 2 — one shared pure module `src/lib/journal/r-math.ts`.**
*Why:* the formula exists twice today (server fn + MCP) with identical defects;
one module makes divergence impossible.
*Alt 1:* a Postgres generated column. Rejected — needs costs and partial-exit
logic that belong in one place, and generated columns are hard to version.
*Alt 2:* leave duplication, add tests to both. Rejected — tests do not prevent
drift, they only detect it late.
*Evidence:* two call sites already drifted in provenance handling.
*Changes my mind:* if R ever has to be queryable in SQL aggregates, a generated
column plus a TS mirror test becomes preferable.

**Decision 3 — the RPC `get_admin_intelligence` must switch basis in the same
release as the app.**
*Why:* P2 — otherwise the admin terminal and the app disagree.
*Alt 1:* leave the RPC alone. Rejected — creates two contradictory win/R numbers.
*Alt 2:* remove `user_reported` from the RPC. Rejected — the owner uses it.
*Evidence:* the RPC body averages `realized_r_multiple` directly.

**Decision 4 — evidence levels gate wording; p-values are demoted, not deleted.**
*Why:* the email template renders `z` and `pValue`; deleting them breaks it, and
the values are still useful as diagnostics.
*Alt 1:* delete significance entirely. Rejected — template regression and loss of
diagnostic continuity.
*Alt 2:* keep p as the gate and add intervals cosmetically. Rejected — that is the
defect being fixed.

**Decision 5 — no holdout claims yet (P8).** Build the ledger and split
machinery; every fold reports `insufficient` until cluster counts justify
otherwise. Alternatives (split now / skip the ledger) are rejected as
overfitting-by-construction and as losing the record of how many alternatives
were tried.

### B1. Corrected mathematics (unchanged, re-verified)

`stop_ref = actual_initial_stop ?? signal.stop_loss`;
`risk = |actual_entry − stop_ref|`; R unavailable when `risk <= 0`, either price
missing, or `partial_exits = true`.
Long `R = (exit − entry − costs)/risk`; short `R = (entry − exit − costs)/risk`.

| case | planned | stop | actual entry | exit | risk | correct R | today |
|---|---|---|---|---|---|---|---|
| long, worse fill | 100 | 95 | 102 | 112 | 7 | **1.4286** | 2.0000 |
| long, better fill | 100 | 95 | 99 | 112 | 4 | **3.2500** | 2.6000 |
| long, stopped | 100 | 95 | 102 | 95 | 7 | **−1.0000** | −1.4000 |
| short | 100 | 105 | 98 | 90 | 7 | **1.1429** | 1.6000 |
| moved stop to 97 | 100 | 95 | 102 | 112 | 5 | **2.0000** | 2.0000 |
| risk 0 | 100 | 100 | 100 | 110 | 0 | **unavailable** | null |
| entry only, no exit | 100 | 95 | 102 | — | 7 | **validation error** | silent null |

### B2. Schema (additive, no backfill)

`executed_trades` gains `actual_initial_stop`, `actual_entry_at`,
`actual_exit_at`, `broker_ticket`, `commission`, `swap`, `partial_exits`,
`r_vs_actual_risk`, `r_basis`, `r_availability`, `verification_level`,
`trade_state`. CHECKs: both prices or neither; `actual_exit_at >=
actual_entry_at`; enumerated values on the three text columns.
**New (P11):** a `BEFORE UPDATE` trigger on `executed_trades` that rejects any
transition out of a resolved state back to `open`/`taken`, so concurrent human and
agent writers cannot reopen a trade.
New `experiments` / `experiment_arms` tables: RLS on, `service_role` only, no
`authenticated` grant. `realized_r_multiple` and `derived_r` are never written
again; a code-level lint test asserts no writer references them.

### B3. Statistics layer

`src/lib/stats/`: `wilson.ts`, `newcombe.ts`, `bootstrap.ts` (deterministic
ordering + explicit seeded RNG + stored method/version/seed/`run_id`),
`clusters.ts`, `evidence.ts`, `bh.ts`.
**Authoritative:** the primary dependence-aware unit is the **whole UTC
`detected_at` day** — never day × instrument. Every observation detected on a
selected day is resampled together. Wilson and Newcombe stay descriptive,
independence-assuming diagnostics; dependence-aware conclusions come only from
the whole-day bootstrap. `evidence.ts` exposes
`insufficient → descriptive → suggestive → actionable`, and `actionable`
additionally requires genuine forward/OOS/holdout confirmation, so it is
unreachable on current data regardless of cluster count or interval width.
BH/q-values are diagnostic only and apply solely to explicitly declared
hypothesis families (the insight generator's comparison set, and the running set
of weekly tests).
**Weekly censoring fix:** a plan enters a fill-rate denominator only after a full
eligible outcome horizon has elapsed inside the window; not-yet-eligible plans
are reported separately as `pending_resolution`.
Grades A+, A, B, C are reported separately; any pooling is opt-in and labelled.
Primary metric everywhere: gross expected R with interval; cost-adjusted R is
shown only where documented cost provenance permits it, and win rate is a
labelled secondary.

### B4. Backend / frontend / MCP

Shared `r-math.ts` used by `trade-journal.functions.ts` and MCP
`update_trade_outcome`; both write only the new columns. Explicit validation
errors for one-sided prices. `get_admin_intelligence` migrated to the new basis in
the same release (P2). `performance.ts` filters by `r_basis` and refuses to
average a mixed sample (P3). `PRESET_R_VALUES` scoped to unpriced rows (P4).
`user-audit.functions.ts` moves to verification levels; the trust metric counts
only `price_backed`+ rows and treats `replay_inconsistent` as negative. History
page gains actual stop, timestamps, ticket and cost fields plus a "scaled out"
toggle that disables R. `export.ts`, `SignalCard.tsx`, `history.tsx` and MCP
`get_performance_summary` / `list_my_trades` emit `r_basis` and
`verification_level`; the word "verified" is removed from tool descriptions and UI.

## C. New acceptance criteria

1. One R implementation; all seven fixtures in B1 pass, including the validation
   error case.
2. No writer anywhere references `realized_r_multiple` or `derived_r`; enforced by
   a test, not by review.
3. `get_admin_intelligence` and the app report the same basis in the same release.
4. A mixed-basis sample returns `mixed_basis`, never an average.
5. Bootstrap output is byte-identical across two runs on the same rows.
6. Cluster keys use detection date; an overlapping-plan fixture proves shared
   clustering.
7. A DB test proves the trigger rejects reopening a resolved trade under two
   concurrent writers.
8. A DB test proves the TS verification/state enums equal the SQL CHECK lists.
9. No prescriptive wording below `actionable`; a snapshot test on the insight
   strings at n = 3 proves it.
10. Zero change to signal count, grade distribution, alerts, webhook dispatches or
    MetaApi request volume — asserted against the pre-deploy baseline.
11. Existing 384 tests green; weekly email template renders with the new fields.

## D. Failure scenarios the architecture must survive

1. **Concurrent human + agent resolution.** Web terminal writes prices while an
   assistant writes a conflicting outcome. Expected: trigger rejects the illegal
   transition, the legal write wins, provenance records exactly one author, no row
   ends with prices from one source and R from another.
2. **Partial write between price and level.** The update sets prices, then the
   process dies before `verification_level`. Expected: single-statement update
   makes this impossible; a reconciliation test asserts no row can exist with
   prices and `verification_level = 'unverified'`.
3. **Bootstrap on one trading day.** 12 filled rows, all same day. Expected:
   `cluster_n = 1`, no interval, `evidence_level = insufficient`, wording is
   descriptive only, and no email claims a difference.
4. **Late-detected plans at window edge.** Plans detected 2h before window close.
   Expected: counted as `pending_resolution`, excluded from fill rate, and the
   report says so rather than reporting a depressed rate.
5. **Stale MCP retry.** Same `update_trade_outcome` call twice with identical
   input. Expected: idempotent, identical R, one `price_recorded_at` semantics
   documented, no duplicate row.

## E. Confidence

**High** on the R defect and its fix: it is proven by code lines and by
hand-calculated fixtures, and it touches no trading logic.
**High** that no trading-model change is smuggled in (P10 trace).
**Medium** on the statistics layer landing as intended: the maths is standard but
the honest output at current sample sizes will be "insufficient" nearly
everywhere, which is a product decision as much as an engineering one.
**Low** on holdout/walk-forward value today: 95 filled rows and a handful of
trading-day clusters cannot support it, so it ships as machinery, not as claims.

## F. What still cannot be guaranteed

Corrected R will not match broker P&L (no reconciliation source exists);
self-reported prices may be untrue; no statistical method can rescue small
samples — some panels will read "insufficient" for months; and with 0 priced rows
today the production impact of the R correction cannot be measured, only proven by
fixtures.

## Recommendation

Proceed with the revised plan: it fixes P1–P9 and P11 relative to the first draft,
keeps the additive dual-basis design, adds the database trigger for the state
machine, defers partial-exit legs and CSCV/PBO, and ships the holdout as
machinery with `insufficient` verdicts rather than as conclusions.
