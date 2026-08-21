# Prompt 8/9 — Fifth-pass red-team review and revised plan

Reviewed as an independent reader against HEAD, the original defect (win-probability
used as expected value; journal R mixing actual prices with planned risk), the
approved fourth-pass plan, and every file/table/API it touches. Everything below
that describes current state was confirmed by reading the code this pass.

## Locked rules carried forward (unchanged)

1. **Binding R mathematics.** `gross_move = long ? actual_exit - actual_entry :
   actual_entry - actual_exit`; `r_vs_plan = gross_move / abs(planned_entry -
   planned_stop)`; `stop_ref = actual_initial_stop ?? planned_stop`;
   `r_vs_actual_risk = gross_move / abs(actual_entry - stop_ref)`. Actual fill is
   always the numerator anchor. Realised movement is never computed from planned
   entry.
2. **Snapshots at row creation.** `planned_entry`, `planned_stop`,
   `planned_direction`, `signal_detected_at`, `signal_instrument`, `signal_grade`,
   `signal_trading_session`, `signal_time_of_day`, `signal_day_of_week` are written
   once when the `executed_trades` row is created and are immutable after.
   `purge_expired_signals()` behaviour and signal FK semantics are unchanged.
3. **No row-level `r_basis`.** Store `r_vs_plan`, `r_vs_actual_risk`,
   `r_availability`, `r_math_version`, `stop_provenance`. Aggregation APIs request
   `plan` or `actual_risk` explicitly; `mixed_basis` is an aggregation error status.
4. **Legacy frozen, not rewritten.** `realized_r_multiple` and `derived_r` are
   read-only provenance. No backfill.
5. **Costs.** Commission/swap are monetary, stored with unit and currency. `net_r`
   is NULL unless a documented conversion to R exists. No cost-adjusted claim
   without cost provenance.
6. **Concurrency.** Once resolved, conflicting mutation of outcome, actual prices,
   actual initial stop, canonical R or provenance is rejected at DB level;
   semantically identical retries are accepted as no-ops.
7. **Statistics.** Primary interval is a whole-UTC-day cluster bootstrap over
   `signal_detected_at` days, preserving every observation in a selected day, with
   stable total order, seeded RNG and stored method/version/seed/run_id.
   Wilson/Newcombe are descriptive diagnostics. BH is diagnostic and applies only to
   predeclared bounded families in the experiment ledger. `actionable` is
   unreachable under the current holdout.
8. **Deletion stays genuine deletion.** No tombstone table in this build.
9. **Out of scope.** No scanner, grading, replay, MetaApi or signal-count change.

## A. Plan defects discovered this pass

**K1 — Prompt 9 keeps a silent row-loss path in personal statistics.**
`performance.ts::samplesFromTrades` joins each trade to its signal and executes
`if (!s) continue`, so a trade whose signal row is not in the fetched set is dropped
from expectancy entirely, and instrument/grade/session/cluster keys all come from
the signal, not the trade. Adding snapshot columns without rewriting this function
leaves the loss in place. **Fix:** snapshots become the authoritative context source
in `samplesFromTrades`; the signal join becomes optional enrichment only, and a test
asserts a trade with no signal row still contributes with correct grade, instrument,
session and cluster day.

**K2 — the resolution trigger turns a double tap into a raw database error.**
Both decision writers use `upsert(..., { onConflict: "user_id,signal_id" })` with
`outcome: "open"` — `queries.ts::logDecision` and MCP `log-trade-decision.ts:27-32`.
On an existing resolved row that upsert becomes an UPDATE that resets `outcome`,
which the new trigger must reject, surfacing a Postgres error in the UI and a tool
failure in MCP. **Fix:** replace both upserts with an explicit read-then-branch —
insert when absent (with snapshots), update decision and provenance only when
present and unresolved, return a friendly already-resolved result when resolved.
`outcome` never appears in an update payload.

**K3 — the "legacy = self-reported" framing is factually wrong for recent rows.**
`trade-journal.functions.ts:74-77` and MCP `update-trade-outcome.ts:76-77` both
write `realized_r_multiple = derivedR`, i.e. the legacy column already holds a
price-derived value for every row written since prices shipped. Labelling the legacy
block "user-reported" in the admin RPC and UI would therefore be a false statement,
and the admin `avg(t.realized_r_multiple)` block simply stops growing after the
freeze while its label implies otherwise. **Fix:** label the legacy block by
provenance and boundary — "pre-`r_math_version` 1 rows, mixed-basis, frozen" — and
have the admin RPC report each block's `n` and its newest `created_at` so a frozen
series is visibly frozen rather than silently stale.

**K4 — MCP performance summary returns an empty set on day one.**
`get-performance-summary.ts:20-40` selects and filters on `realized_r_multiple`
only. Once writers stop populating it, every new trade is filtered out and the tool
reports n = 0 while the web terminal shows data. **Fix:** migrate that tool in the
same release, reading both canonical columns, selecting one basis explicitly, never
summing across bases, and never adding legacy and canonical rows into one mean.

**K5 — two UI surfaces would print a false 0.00R.**
`SignalCard.tsx:978` renders `Number(trade.realized_r_multiple ?? 0).toFixed(2)}R`
and `history.tsx:384` falls back through `derived_r ?? realized_r_multiple`. With
writers frozen, both display `0.00R` for a resolved trade that has no legacy value —
a fabricated number, not a missing one. **Fix:** both surfaces render an explicit
unavailable marker when the selected basis is NULL, with `r_availability` driving
the wording; no numeric coalesce to zero anywhere.

**K6 — export schema compatibility.** `export.ts:168` and `:207` emit
`realized_r_multiple` as the CSV column and the JSON `r_yield` field. Renaming or
repurposing either breaks anyone's saved spreadsheet. **Fix:** keep both existing
fields byte-compatible, append `r_vs_plan`, `r_vs_actual_risk`, `r_availability`,
`r_math_version`, `stop_provenance`, and document in the header row that `r_yield`
is legacy.

## B. Major design decisions

**D1 — dual canonical columns rather than one column plus a basis discriminator.**
*Why:* a trade legitimately has both values, and a single column forces a lossy
choice at write time. *Alt A:* one `r` column + `r_basis` — rejected, it makes
correct aggregation depend on filtering and invites the exact mixed-basis average
the original defect is about. *Alt B:* compute R on read only — rejected, the
inputs (planned entry/stop) are not guaranteed to be present forever and SQL
aggregates could not reproduce TypeScript rounding. *Evidence:* the admin RPC
already averages R in SQL, so a stored, basis-explicit value is required for app and
admin to agree. *Changes my mind:* if all aggregation moved into TypeScript.

**D2 — snapshot journal context at creation.** *Why:* it makes R and the bootstrap
cluster key reproducible from the journal row alone and removes the K1 join
dependency. *Alt A:* join the signal at read time — rejected, that is the current
silent-drop behaviour. *Alt B:* snapshot at resolution — rejected, the planned
values must be captured before the trader can influence them. *Evidence:*
`samplesFromTrades` derives instrument, grade, session and the cluster day purely
from the signal today.

**D3 — read-then-branch decision writers instead of upsert.** *Why:* K2 — upsert
cannot express "leave resolution alone". *Alt A:* keep upsert and omit `outcome`
from the payload — rejected, an insert then has no initial state and the update
path still cannot distinguish resolved from unresolved for messaging. *Alt B:* a
`SECURITY DEFINER` RPC — rejected as unnecessary surface for a row the user already
owns under RLS. *Residual:* the read-then-branch race is closed by the DB trigger,
not by the client.

**D4 — whole-UTC-day cluster bootstrap as the primary interval.** *Why:* plans on
the same day share regime and overlap, so per-trade independence is invalid.
*Alt A:* per-trade Wilson/t intervals — rejected, understates width. *Alt B:*
per-instrument-day clusters — rejected, correlated instruments on one day would
still be treated as independent. *Changes my mind:* evidence that same-day
cross-instrument outcomes are near-independent.

**D5 — `evidence.ts` as the single sufficiency gate.** *Why:* `weekly.ts:10`
`MIN_TIER_SAMPLES = 30` and `:233-234` already implement a second, different gate
than the one the statistics module will own; two gates cannot stay consistent.
*Alt A:* keep both — rejected. *Alt B:* delete `MIN_TIER_SAMPLES` — rejected, it is
referenced by existing tests and email wording; derive it from `evidence.ts`.

**D6 — holdout ships as machinery, not conclusions.** *Alt A:* split the current
filled rows into train/holdout now — rejected as overfitting by construction.
*Alt B:* skip the ledger — rejected, it is the multiplicity denominator.

## C. Failure scenarios the architecture must survive

1. **Purged or unfetched signal.** A resolved trade whose signal row is not in the
   query result. Expected: it still contributes to expectancy with the correct
   grade, instrument, session and cluster day from snapshots, and `r_vs_plan`
   recomputes to the stored value. (K1)
2. **Double decision tap / repeated MCP call on a resolved trade.** Expected: a
   friendly already-resolved result from both writers, `outcome` untouched, no raw
   trigger error reaching the UI or the tool response. (K2)
3. **Concurrent human + agent resolution.** Web writes prices while an assistant
   writes a conflicting outcome. Expected: one wins, the conflicting write is
   rejected at DB level, identical retries are no-ops, and no row ends with prices
   from one author and R from another.
4. **First canonical trade, all surfaces.** One resolved canonical trade and no
   legacy value. Expected: web, MCP and admin agree on the same basis and the same
   number; nothing anywhere prints `0.00R`. (K4, K5)
5. **Single trading day.** 12 filled rows on one UTC day. Expected: `cluster_n = 1`,
   no interval, `insufficient`, no prescriptive wording, and the weekly email says
   why.

## D. Revised plan

**Stage 1 — pure modules (no DB, no behaviour change).**
`src/lib/journal/r-math.ts`: the binding formulas, `r_availability` reasons, stop and
cost provenance, explicit validation errors for one-sided prices, `r_math_version`.
`src/lib/stats/{wilson,newcombe,clusters,bootstrap,evidence,bh}.ts`: whole-UTC-day
clustering, stable total order (`signal_detected_at`, then `id`), seeded PRNG, fixed
accumulation order, stored method/version/seed/run_id, `actionable` gated behind
holdout confirmation, BH restricted to predeclared bounded families.

**Stage 2 — additive migration, no backfill.** `executed_trades` gains the nine
immutable snapshot columns, plus `actual_initial_stop`, `stop_provenance`,
`actual_entry_at`, `actual_exit_at`, `broker_ticket`, `commission`, `swap`,
`cost_currency`, `cost_unit`, `partial_exits`, `r_vs_plan`, `r_vs_actual_risk`,
`r_availability`, `r_math_version`, `net_r`, `verification_level`, `trade_state`.
CHECKs: both actual prices or neither, `actual_exit_at >= actual_entry_at`,
enumerated text values. New `experiments` and `experiment_arms`: RLS on,
`service_role` only, GRANTs in the same migration, plus `get_admin_experiments()`
guarded by `is_admin()`. No tombstone table.

**Stage 3 — DB enforcement.** `BEFORE UPDATE` trigger with rounded (4 dp), NULL-safe
comparison: identical retry → no-op, conflicting re-resolution → reject; plus
immutability enforcement on the nine snapshot columns. A DB test mirrors TS enums
against the SQL CHECK lists. Deletion is untouched.

**Stage 4 — synchronised basis migration (single release).** `r-math.ts` used by
`trade-journal.functions.ts` and MCP `update-trade-outcome`, writing only the new
columns. `performance.ts` reads snapshots as authoritative context (K1), takes an
explicit basis argument and returns `mixed_basis` on an attempted mixed aggregation.
MCP `get-performance-summary` and `list-my-trades` migrate in the same release (K4),
emitting both canonical values plus `r_availability` and `r_math_version`; tool names
and schemas stay compatible and descriptions drop "verified" for the ladder wording.
`get_admin_intelligence` returns `user_reported_legacy` and `user_reported_canonical`,
each with `n` and newest `created_at`, the legacy block labelled as frozen
pre-`r_math_version` 1 mixed-basis data (K3). Both decision writers move to
read-then-branch (K2). `history.tsx` and `SignalCard.tsx` render an unavailable
marker instead of `0.00R` (K5). `export.ts` keeps existing fields and appends the
canonical ones (K6). `user-audit.functions.ts`: `preset_r_value` scoped to unpriced
rows, `r_exceeds_max_r` compared only against `r_vs_plan`.

**Stage 5 — statistics reporting.** `evidence.ts` becomes the only sufficiency gate
and `Verdict` derives from it (D5); `z`/`pValue` demoted to diagnostics;
day-clustered intervals everywhere a range is shown; fill-rate denominators use the
shared maturity horizon with `pending_resolution` reported separately; every figure
basis-labelled; grades reported separately; weekly email template render test.

## E. New acceptance criteria

1. R fixtures assert `r_vs_plan` and `r_vs_actual_risk` separately, including
   actual-stop vs planned-stop-fallback provenance and the one-sided-price error.
2. An attempted mixed-unit aggregation returns `mixed_basis`; a row holding both
   values aggregates cleanly under either basis; no code path averages legacy and
   canonical together.
3. A resolved trade with no signal row still appears in expectancy with correct
   grade, instrument, session and cluster day (K1).
4. Repeat decision write from web and from MCP on a resolved trade returns an
   already-resolved result, changes no resolution field, and raises no DB error (K2).
5. Snapshot columns are written once at creation and any later mutation is rejected.
6. Web, MCP and admin report the same number for the same basis on a single
   canonical trade; the admin legacy block is labelled frozen with `n` and newest
   `created_at` (K3, K4).
7. No surface renders `0.00R` for a NULL R; export keeps `realized_r_multiple` and
   `r_yield` and appends the canonical fields (K5, K6).
8. Two bootstrap runs are byte-identical with stored seed/method/version/run_id; one
   UTC day of multi-instrument rows forms exactly one cluster.
9. `actionable` unreachable under the current holdout; no prescriptive wording at
   n = 3.
10. DB tests: identical retry accepted, conflicting re-resolution rejected,
    human-win vs agent-loss race, snapshot immutability, TS enums equal SQL CHECKs.
11. Monetary-only costs leave `net_r` NULL and no cost-adjusted claim appears.
12. Weekly email renders with `pending_resolution` and basis labels; `Verdict`
    derives from `evidence.ts`.
13. Zero change to signal count, grade distribution, alerts, webhook dispatches or
    MetaApi request volume; `bun run verify` green (421 baseline).

## F. Remaining risks

Self-reported prices can still be untrue. At current sample sizes the honest output
reads "insufficient" almost everywhere, including in the weekly email. The
legacy/canonical dual display adds interpretation burden. The conflict trigger can
block a legitimate late correction until a correction workflow exists. Because
deletion stays genuine deletion, a delete-and-relog path remains open until broker
reconciliation exists.

## G. Confidence

**High** that K1–K6 are real and are proven by specific lines at HEAD
(`performance.ts` signal join, both writers' upserts, `trade-journal.functions.ts:77`,
`get-performance-summary.ts:25`, `SignalCard.tsx:978`, `export.ts:207`). **High**
that no trading-model, scanner or MetaApi change is smuggled in — Stage 1–5 touch no
scanner, grading, replay or fetch code. **Medium** on product reception of a
statistics layer that mostly says "insufficient". **Low** on holdout value today: it
ships as machinery, not conclusions.

## H. What still cannot be guaranteed

Truthfulness of manually entered prices; that no user misreads a descriptive Wilson
interval as inferential; that a determined user cannot reshape their own personal
statistics by deleting rows; and that same-day cross-instrument dependence is fully
absorbed by day clustering rather than merely reduced.
