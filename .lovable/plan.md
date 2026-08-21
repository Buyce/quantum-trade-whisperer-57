# Fourth-Pass Red-Team Review — Prompt 8 (Statistics) & Prompt 9 (Journal R)

Independent re-review against current HEAD, the original defect, and every file,
table and API the plan touches. Eight new defects found. The core design survives;
one of the new findings (M1) is a genuine correctness hole in the approved
concurrency rule, and one (M2) would make R non-reproducible. Nothing implemented.

## Authoritative rules (binding, supersede everything below)

- Canonical R = `r_vs_plan` **and** `r_vs_actual_risk`; both may coexist on one
  trade. `realized_r_multiple` and `derived_r` are frozen legacy provenance, never
  written again, never backfilled.
- Binding mathematics:

```text
gross_move        = long ? actual_exit - actual_entry : actual_entry - actual_exit
r_vs_plan         = gross_move / abs(planned_entry - planned_stop)
stop_ref          = actual_initial_stop ?? planned_stop
r_vs_actual_risk  = gross_move / abs(actual_entry - stop_ref)
```

  The actual fill is always the numerator anchor for both measures; realized
  movement is never computed from planned entry.
- Aggregations explicitly select the plan or the actual-risk basis and never
  combine them. `mixed_basis` = an attempted mixed-unit aggregation, not a row
  holding both values.
- Monetary commission/swap never enter gross R. Store amount, currency and unit
  provenance; net R stays NULL without a documented price-distance conversion.
  Gross R is primary.
- Resolved-state protection covers conflicting **re-resolution**, not just
  reopening. Identical retries accepted idempotently; conflicting outcome, prices,
  stop, canonical R or provenance rejected at DB level unless an authorised
  correction workflow is used.
- Primary clustering unit = **whole UTC `detected_at` day**; never day ×
  instrument.
- `actionable` requires genuine forward/OOS/holdout confirmation, so it is
  unreachable on current data.
- Wilson/Newcombe are descriptive independence-assuming diagnostics only.
- BH families are predeclared and bounded in the experiment ledger — never a
  rolling indefinite family.
- Weekly censoring: a plan enters a fill-rate denominator only after a full
  eligible outcome horizon.

## Final build lock (binding, supersedes any contradictory text below)

1. **Snapshot at row creation, not resolution.** When an `executed_trades` row is
   first created, snapshot `planned_entry`, `planned_stop`, `planned_direction`,
   `signal_detected_at`, `signal_instrument`, `signal_grade`,
   `signal_trading_session`, `signal_time_of_day`, `signal_day_of_week`. Immutable
   afterwards, and the canonical source for journal R and performance context.
   `purge_expired_signals()` already skips signals referenced by a taken trade —
   that behaviour and the current signal FK semantics are unchanged, and the
   "purged signal with surviving journal row" scenario is removed as impossible.
2. **Decision writers.** Both `queries.ts::logDecision` and MCP
   `log_trade_decision` are fixed: insert initialises state; update changes only
   decision and provenance; neither resets `outcome` on an existing row. A resolved
   row returns a friendly already-resolved result and no resolution field changes.
3. **Deletion stays genuine deletion.** No `trade_resolution_audit` tombstone in
   Prompt 8/9. Deleted trades disappear from personal statistics. Tamper-resistant
   broker reconciliation is a separate future capability.
4. **R representation.** No single ambiguous row-level `r_basis`. Store
   `r_vs_plan`, `r_vs_actual_risk`, `r_availability`, `r_math_version`,
   `stop_provenance`. Aggregation APIs explicitly request `plan` or `actual_risk`;
   `mixed_basis` is an aggregation error status, never a row attribute.

Every other authoritative mathematical, statistical, concurrency, provenance, RLS,
experiment-ledger, weekly-censoring and testing requirement below is preserved.
Prompt 8 is implemented and verified first, then Prompt 9.

## A. Plan defects discovered in this pass

**M1 — DELETE bypasses the UPDATE conflict rule (accepted, not mitigated).**
`queries.ts` exposes `deleteTrade` and `deleteAllTrades`, which a `BEFORE UPDATE`
trigger cannot see, so a delete-and-relog path exists. Per the build lock, deletion
remains genuine deletion and no tombstone is introduced in this build; the residual
gap is recorded as a known limitation to be closed later by broker reconciliation.


**M2 — `r_vs_plan` is not reproducible without a planned-price snapshot.**
Both canonical values are defined against `planned_entry` / `planned_stop`, which
live only on `scanned_signals`, and `purge_expired_signals()` hard-deletes signal
rows on a grade-tiered retention schedule. Any journal row whose signal is later
purged loses its denominator, so a recomputation returns a different answer than
the stored one. Fix: snapshot `planned_entry`, `planned_stop`, `planned_direction`
and `signal_detected_at` onto `executed_trades` at resolution time. This also
gives the statistics layer its cluster key without a join.

**M3 — the cluster key currently depends on a joinable signal.** `performance.ts`
derives `detectedAt` from the joined signal (`samplesFromTrades`), so a purged
signal drops the sample entirely and silently changes cluster counts between runs
— a reproducibility break in the bootstrap, not just missing data. The M2 snapshot
resolves this; without it, "byte-identical across two runs" is unachievable.

**M4 — re-clicking a decision on a resolved trade becomes a raw DB error.**
`logDecision` upserts `outcome: "open"` on conflict `(user_id, signal_id)`. Once
the trigger exists, tapping Taken/Skipped again on an already-resolved trade
raises a trigger exception that surfaces as an unhandled error toast. The write
path must send only the decision fields (no `outcome` reset) and the UI must show
an explicit "this trade is already resolved" state rather than a failure.

**M5 — two disagreeing sufficiency gates.** `weekly.ts` has `MIN_TIER_SAMPLES = 30`
and its own `Verdict` union (`significant | not_significant | insufficient`), while
the plan adds `evidence.ts` with four levels. Left as-is, one module can say
`significant` while the other says `descriptive` — duplicated business logic in the
exact place the prompt targets. `evidence.ts` must become the single source of
truth and `Verdict` derived from it.

**M6 — basis juxtaposition in the weekly email is a false comparison.**
`weekly.server.ts` reads shadow `realized_r` (engine planned-risk basis) while the
journal moves to canonical dual R. The email renders both sets of numbers under
one heading. Every figure must be basis-labelled, or the report states a comparison
that is not valid. `reportEmailData` maps nulls to `"n/a"`, so adding
`pending_resolution` needs a template render test to avoid a delivery regression.

**M7 — the censoring fix will empty the weekly report, and that must be stated.**
Excluding plans without a full outcome horizon lowers every denominator; combined
with `MIN_TIER_SAMPLES = 30` almost every weekly email becomes "insufficient". This
is correct behaviour but it is a visible product change that should ship with
wording explaining why, not as an apparent regression.

**M8 — the experiment ledger must snapshot family size at run time.** With BH
families predeclared but the underlying rows deletable (M1) and maturing over time,
a stored q-value can stop matching a recomputation. The ledger stores the declared
family, its member count, seed, method, method version and `run_id` at execution,
and results are immutable thereafter.

**Re-checked and still clean:** no trading-model change — `grading.ts`,
`profile.ts`, `indicators.ts`, `pipeline.server.ts`, replay labellers and the
MetaApi client are untouched, so signal count, grade mix, alerts, webhook
dispatches and MetaApi request volume are unchanged. No SSRF, no new auth surface,
no RLS weakening (new tables service-role only plus an `is_admin()` RPC). No
lookahead: clusters key on detection, never resolution. No backfill, so no
historical contamination. Additive nullable columns stay reversible.

## B. Design decisions, interrogated

**D1 — additive canonical columns plus planned-price snapshot (M2).**
*Why:* preserves the 19 legacy rows, makes basis explicit, survives signal purge.
*Alt A:* correct in place — rejected, destroys the audit trail. *Alt B:* join to
`scanned_signals` at read time — rejected, purge makes it non-reproducible.
*Evidence:* legacy column is overwritten on every update today; 0 rows carry both
prices; the purge function hard-deletes signals.
*Changes my mind:* if signal retention became permanent, the snapshot would be
redundant.

**D2 — one pure `src/lib/journal/r-math.ts`.**
*Why:* the same defective formula exists twice (server fn + MCP).
*Alt A:* Postgres generated column — rejected, needs cost/partial-exit logic and is
hard to version. *Alt B:* keep duplication + tests — rejected, tests detect drift
late. *Changes my mind:* if R must be aggregated in SQL.

**D3 — synchronised app + MCP + admin-RPC migration, legacy shown separately.**
*Why:* `performance.ts:104` and MCP `get_performance_summary` both filter on the
legacy column, so freezing it alone empties both surfaces; the admin RPC averages
it server-side. *Alt A:* TypeScript-only — rejected, admin and app disagree.
*Alt B:* swap the RPC outright — rejected, the tile drops to n = 0 and reads as
data loss.

**D4 — UPDATE conflict trigger only; deletion stays genuine deletion.**
*Why:* the build lock keeps user erasure real, and only the database can arbitrate
concurrent updates. *Alt A:* delete tombstones — rejected by the build lock.
*Alt B:* forbid deleting resolved trades — rejected, users must be able to erase
their own data. *Changes my mind:* broker reconciliation later makes tamper
resistance meaningful.

**D5 — `evidence.ts` as the only sufficiency gate (M5).**
*Why:* two gates cannot be kept consistent. *Alt A:* keep both — rejected.
*Alt B:* delete `MIN_TIER_SAMPLES` outright — rejected, it is referenced by tests
and email wording; derive it instead.

**D6 — holdout as machinery, never a claim.** Alternatives (split 95 filled rows
now / skip the ledger) rejected as overfitting-by-construction and as losing the
multiplicity denominator.

## C. Failure scenarios the architecture must survive

1. **Snapshot immutability.** A trade is created, then the signal's row is later
   edited or the trade is re-resolved. Expected: the nine snapshot fields never
   change, and `r_vs_plan` recomputes to the identical stored value from them.
2. **Concurrent human + agent resolution.** Web writes prices while an assistant
   writes a conflicting outcome. Expected: one write wins, the conflicting one is
   rejected at DB level, identical retries are accepted as no-ops, and no row ends
   with prices from one author and R from another.
3. **Repeat decision write on a resolved trade** from either the web terminal or
   MCP. Expected: friendly already-resolved result, no `outcome` reset, no raw
   trigger error.
4. **Single trading day of data.** 12 filled rows, one UTC day. Expected:
   `cluster_n = 1`, no interval, `insufficient`, no prescriptive wording, weekly
   email states why.

## D. Revised plan

**Stage 1 — pure modules.** `src/lib/journal/r-math.ts` implementing the binding
formulas, availability reasons, stop and cost provenance, and explicit validation
errors for one-sided prices. `src/lib/stats/{wilson,newcombe,clusters,bootstrap,
evidence,bh}.ts`: whole-UTC-day clustering, stable total order
(`signal_detected_at`, `id`), seeded PRNG, fixed accumulation order, stored
method/version/seed/`run_id`, `actionable` gated behind holdout confirmation, BH on
predeclared bounded families only.

**Stage 2 — additive migration, no backfill.** `executed_trades` gains the nine
immutable creation-time snapshot columns (`planned_entry`, `planned_stop`,
`planned_direction`, `signal_detected_at`, `signal_instrument`, `signal_grade`,
`signal_trading_session`, `signal_time_of_day`, `signal_day_of_week`) plus
`actual_initial_stop`, `stop_provenance`, `actual_entry_at`, `actual_exit_at`,
`broker_ticket`, `commission`, `swap`, `cost_currency`, `cost_unit`,
`partial_exits`, `r_vs_plan`, `r_vs_actual_risk`, `r_availability`,
`r_math_version`, `net_r`, `verification_level`, `trade_state`. No row-level
`r_basis`. CHECKs: both prices or neither, `actual_exit_at >= actual_entry_at`,
enumerated text. New `experiments` and `experiment_arms`: RLS on, `service_role`
only, GRANTs in the same migration, plus `get_admin_experiments()` guarded by
`is_admin()`. No tombstone table.

**Stage 3 — DB enforcement.** `BEFORE UPDATE` conflict trigger with rounded,
NULL-safe comparison (identical retry → no-op; conflict → reject), plus immutability
enforcement on the nine snapshot columns. TS enums mirrored against SQL CHECK lists
by a DB test. Deletion is left untouched.

**Stage 4 — synchronised basis migration.** `r-math.ts` used by
`trade-journal.functions.ts` and MCP `update_trade_outcome`, writing only the new
columns. `performance.ts` and every aggregation API take an explicit `plan` or
`actual_risk` basis argument and return the `mixed_basis` error status when a
caller attempts a mixed-unit aggregation. MCP `get_performance_summary` /
`list_my_trades` emit both canonical values, `r_availability` and `r_math_version`;
tool names and schemas unchanged, descriptions drop the word "verified" for the
ladder. `get_admin_intelligence` returns `user_reported_legacy` **and**
`user_reported_canonical`. Both decision writers — `queries.ts::logDecision` and
MCP `log_trade_decision` — initialise state on insert, update only decision and
provenance, never reset `outcome`, and return a friendly already-resolved result on
a resolved row. `export.ts`, `history.tsx`, `SignalCard.tsx` label legacy values as
legacy. `user-audit.functions.ts`: `preset_r_value` scoped to unpriced rows,
`r_exceeds_max_r` compared only against `r_vs_plan`.

**Stage 5 — statistics reporting.** `evidence.ts` becomes the single sufficiency
gate and `Verdict` derives from it (M5); `z`/`pValue` demoted to diagnostics;
day-clustered intervals; fill-rate denominators use the shared maturity horizon
with `pending_resolution` reported separately; every figure basis-labelled (M6);
grades reported separately; email template render test.

## E. New acceptance criteria

1. All seven R fixtures pass with `r_vs_plan` and `r_vs_actual_risk` asserted
   separately, plus the one-sided-price validation error.
2. No writer references the legacy columns; allow-listed readers still render the
   19 legacy rows.
3. `performance.ts` and MCP `get_performance_summary` return non-empty results for
   a canonical-basis trade.
4. `get_admin_intelligence` returns both blocks; app, MCP and admin agree.
5. An attempted mixed-unit aggregation returns the `mixed_basis` error status; a
   row holding both canonical values aggregates cleanly under either basis.
6. The nine snapshot fields are written once at row creation, are rejected on any
   later mutation, and `r_vs_plan` recomputes identically from them.
7. Two bootstrap runs are byte-identical with stored seed/method/version/run_id;
   one UTC day of multi-instrument rows forms exactly one cluster.
8. `actionable` unreachable; no prescriptive wording at n = 3.
9. DB tests: identical retry accepted, conflicting re-resolution rejected,
   human-win vs agent-loss race, snapshot immutability, repeat decision write from
   both writers leaves resolution untouched, TS enums equal SQL CHECK lists.
10. Monetary-only costs leave `net_r` NULL and no cost-adjusted claim appears.
11. Weekly email renders with `pending_resolution` and basis labels; `Verdict`
    derives from `evidence.ts`.
12. Zero change to signal count, grade distribution, alerts, webhook dispatches or
    MetaApi request volume; `bun run verify` green (421 baseline).

## F. Remaining risks

Self-reported prices can still be untrue; the honest output at current sample sizes
reads "insufficient" nearly everywhere, including in the weekly email; the
legacy/canonical dual display adds interpretation burden; the conflict trigger can
block a legitimate late correction until the correction workflow exists; and because
deletion stays genuine deletion, a delete-and-relog path remains open until broker
reconciliation exists.

## G. Confidence

**High** on the R mathematics and on M1–M4 being real blockers — each is proven by
specific lines at HEAD (`queries.ts` deletes, `purge_expired_signals`,
`performance.ts:104`, `logDecision`). **High** that no trading-model change is
smuggled in. **Medium** on product reception of the statistics layer. **Low** on
holdout value today: it ships as machinery, not conclusions.

## H. What still cannot be guaranteed

Corrected R will not reconcile against broker P&L (no reconciliation source
exists); no method rescues small samples; with 0 priced rows today the production
effect of the R correction can only be proven by fixtures, not measured.
