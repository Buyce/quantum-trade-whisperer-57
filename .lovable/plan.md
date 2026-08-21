# Third-Pass Red-Team Review — Prompt 8 (Statistics) & Prompt 9 (Journal R)

Independent review of the already-approved plan against current HEAD. Nine new
defects found, all of them in the *migration path* rather than in the mathematics.
The core design (additive dual-basis R, shared pure module, whole-UTC-day
bootstrap, DB-enforced resolved state) survives review unchanged. Nothing has been
implemented.

## Authoritative rules (unchanged, supersede everything below)

- Canonical R = `r_vs_plan` **and** `r_vs_actual_risk`. `realized_r_multiple` and
  `derived_r` are frozen legacy provenance and are never written again.
- Monetary commission/swap are never subtracted from price movement. Store amount,
  currency and unit provenance. Net/cost-adjusted R stays NULL unless a documented
  price-distance conversion exists. **Gross R is the primary metric otherwise.**
- Resolved-state protection covers conflicting **re-resolution**, not just
  reopening. Semantically identical retries are accepted idempotently; any later
  conflicting outcome, price, stop, canonical R or provenance is rejected at DB
  level unless an authorised correction workflow is used.
- Primary clustering unit = **whole UTC `detected_at` day**. Never day ×
  instrument. All observations on a selected day resample together.
- `actionable` requires genuine forward/OOS/holdout confirmation and is therefore
  unreachable on current data, whatever the cluster count or interval width.
- Wilson/Newcombe are descriptive, independence-assuming diagnostics only.
  Dependence-aware conclusions come only from the whole-day bootstrap.
- BH/q-values are diagnostic only, on explicitly declared hypothesis families.
- Weekly censoring: a plan enters a fill-rate denominator only after a **full
  eligible outcome horizon** has elapsed.

## A. Plan defects discovered in this pass

**N1 — freezing the legacy column silently empties the personal performance page.**
`performance.ts:103` skips any trade where `realized_r_multiple === null`. Stop
writing that column and every future trade is dropped from expectancy, insights
and the heat map — the page reads "no data" forever while trades exist. This is
the hidden backwards incompatibility the previous pass missed. `samplesFromTrades`
must move to the canonical columns in the *same* commit that stops the write.

**N2 — identical MCP regression.** `get_performance_summary` filters
`realized_r_multiple !== null`, so it would answer "No resolved trades yet —
performance metrics are all zero" indefinitely. That is a semantic regression an
assistant cannot detect. It must migrate in the same release, and `list_my_trades`
must expose `r_basis` / `r_availability` so an agent can tell "unavailable" from
"zero".

**N3 — the promised lint test as written is wrong.** "No writer *or reference* to
the legacy columns" would force deleting the readers that display the 19 historic
rows and the audit panel's contradiction detection. Correct criterion: forbid
**writes** (allow-listed reads only) — `export.ts:168,207`,
`history.tsx:312,384`, `SignalCard.tsx:971-978`, `queries.ts:44,66` keep reading,
clearly labelled `legacy`.

**N4 — the admin tile drops to n = 0 on release.** `get_admin_intelligence`
averages `realized_r_multiple`; switching it to the canonical basis removes all
legacy rows, since 0 rows have both prices. The owner would see a populated tile
become empty and read it as a bug. The RPC must return **both** blocks —
`user_reported_legacy` (frozen, labelled) and `user_reported_canonical`
(n = 0 today) — never a silent swap.

**N5 — float noise makes idempotent retries look like conflicts.** Two identical
`update_trade_outcome` calls recompute R through floating point; a
bit-for-bit equality trigger can reject the second call. Comparison must be on
canonically rounded values (4 dp, the existing convention) with NULL-safe
equality, and the trigger must distinguish `identical_retry` (accept, no-op) from
`conflict` (reject).

**N6 — byte-identical bootstrap needs summation order pinned, not just the RNG.**
A seeded PRNG alone does not give reproducibility: the mean depends on addition
order. Requires a stable total order (`detected_at`, then `id`) applied *before*
resampling, accumulation in that fixed order, and rounding at the boundary. Store
`method`, `method_version`, `seed`, `run_id`.

**N7 — `experiments` tables as service-role-only would be unreadable by the admin
terminal.** RLS with no `authenticated` grant is right, but the panel then needs a
`SECURITY DEFINER` `get_admin_experiments()` with the standard
`is_admin()`-or-`forbidden` guard, matching the existing admin RPCs. Without it
the ledger ships write-only.

**N8 — `PRESET_R_VALUES` scoping is already partly correct, and over-scoping would
lose signal.** `user-audit.functions.ts:185` already requires `!hasPrices`. The
change is narrower than the plan implied: re-point it at
`r_availability = 'unavailable_no_prices'` and leave the heuristic otherwise
alone. `r_exceeds_max_r` (line 188) must move to `r_vs_plan` only — comparing an
actual-risk R against the plan's `max_r` is a basis mismatch that would fire
false accusations against honest traders.

**N9 — "full eligible outcome horizon" must be defined in one place or it will
diverge.** `weekly.ts` has no horizon concept today; the payoff layer already uses
24 h maturity. Reuse that single constant rather than inventing a weekly-only
horizon, otherwise two censoring rules coexist.

**Re-checked and clean:** no trading-model change (`grading.ts`, `profile.ts`,
`indicators.ts`, `pipeline.server.ts`, replay labellers, MetaApi untouched — signal
count, grades, alerts, webhook dispatches and MetaApi request volume unchanged);
no SSRF or new auth surface; no RLS weakening; no lookahead (clusters keyed on
detection, never resolution); no backfill, so no historical contamination; additive
nullable migration stays reversible.

## B. Design decisions, interrogated

**D1 — additive canonical columns; legacy frozen.**
*Why:* preserves the only 19 real rows, makes basis explicit, reversible.
*Alt A:* correct in place — rejected, destroys the audit trail.
*Alt B:* derive R at read time — rejected, actual stop and costs do not exist as
inputs, so there is nothing to derive from.
*Evidence:* legacy column is overwritten on every update today; 0 rows carry both
prices.
*Changes my mind:* if the owner accepts losing the legacy series, in-place is
simpler.

**D2 — one pure `src/lib/journal/r-math.ts`.**
*Why:* the formula exists twice (server fn + MCP) with identical defects.
*Alt A:* Postgres generated column — rejected, needs cost and partial-exit logic
and is hard to version. *Alt B:* keep duplication + tests — rejected, tests detect
drift late instead of preventing it.
*Changes my mind:* if R must be aggregated in SQL, a generated column plus a
mirror test wins.

**D3 — synchronised app + MCP + admin-RPC migration, with legacy shown separately
(N1/N2/N4).**
*Why:* any partial migration produces two contradictory numbers, or a silently
empty surface. *Alt A:* TS-only — rejected (N4). *Alt B:* swap the RPC outright —
rejected, looks like data loss.

**D4 — whole-UTC-day cluster bootstrap as the only dependence-aware method.**
*Why:* same-day plans share regime and overlap in time. *Alt A:* day × instrument
— rejected by the binding rule and because cross-instrument same-day correlation
is real. *Alt B:* plan-level i.i.d. bootstrap — rejected, assumes the independence
that is known to be false.
*Changes my mind:* nothing at this sample size; a block bootstrap becomes worth
revisiting past a few hundred clusters.

**D5 — DB trigger for resolved-state protection, retry-tolerant (N5).**
*Why:* two writers (web + MCP) upsert the same `(user_id, signal_id)`; only the
database can arbitrate. *Alt A:* server-side state machine — rejected, not
enforceable across writers. *Alt B:* conditional `WHERE` predicates — rejected,
every call site must remember them.

**D6 — holdout as machinery, never as a claim.**
*Why:* 95 filled rows and a handful of day clusters cannot validate anything.
*Alt A:* split now — rejected, overfitting by construction. *Alt B:* skip the
ledger — rejected, loses the record of how many alternatives were tried, which is
the multiplicity denominator.

## C. Corrected mathematics (re-verified)

`stop_ref = actual_initial_stop ?? signal.stop_loss` with explicit
`stop_provenance`; `risk = |actual_entry − stop_ref|`; R unavailable when
`risk <= 0`, either price missing, or `partial_exits = true`.
Gross long `R = (exit − entry)/risk`; short `R = (entry − exit)/risk`.
`r_vs_plan` uses planned entry and planned stop; `r_vs_actual_risk` uses actual
entry and `stop_ref`. Monetary costs never enter the numerator.

| case | planned | stop | actual entry | exit | risk | `r_vs_actual_risk` | today |
|---|---|---|---|---|---|---|---|
| long, worse fill | 100 | 95 | 102 | 112 | 7 | **1.4286** | 2.0000 |
| long, better fill | 100 | 95 | 99 | 112 | 4 | **3.2500** | 2.6000 |
| long, stopped | 100 | 95 | 102 | 95 | 7 | **−1.0000** | −1.4000 |
| short | 100 | 105 | 98 | 90 | 7 | **1.1429** | 1.6000 |
| stop moved to 97 | 100 | 95 | 102 | 112 | 5 | **2.0000** | 2.0000 |
| risk 0 | 100 | 100 | 100 | 110 | 0 | **unavailable** | null |
| entry only, no exit | 100 | 95 | 102 | — | 7 | **validation error** | silent null |

## D. Revised plan

**Stage 1 — pure modules, no wiring.** `src/lib/journal/r-math.ts` (dual basis,
availability reasons, stop provenance, cost provenance without conversion);
`src/lib/stats/{wilson,newcombe,clusters,bootstrap,evidence,bh}.ts` with the
whole-UTC-day unit, stable total order, seeded PRNG, stored
method/version/seed/run_id, and `actionable` gated behind holdout confirmation.
Fixtures for all seven R cases plus mixed-basis refusal.

**Stage 2 — additive migration, no backfill.** `executed_trades` gains
`actual_initial_stop`, `stop_provenance`, `actual_entry_at`, `actual_exit_at`,
`broker_ticket`, `commission`, `swap`, `cost_currency`, `cost_unit`,
`partial_exits`, `r_vs_plan`, `r_vs_actual_risk`, `r_basis`, `r_availability`,
`net_r` (NULL without conversion), `verification_level`, `trade_state`. CHECKs:
both prices or neither, `actual_exit_at >= actual_entry_at`, enumerated text.
`experiments` / `experiment_arms`: RLS on, `service_role` only, plus admin RPC
(N7). Grants written in the same migration.

**Stage 3 — resolved-state trigger (N5).** `BEFORE UPDATE` on `executed_trades`:
rounded, NULL-safe comparison of outcome, prices, actual stop, canonical R and
provenance. Identical retry → accepted no-op; any conflict → rejected. Correction
workflow is a separate explicit path.

**Stage 4 — synchronised basis migration (N1–N4, N8).** `r-math.ts` used by
`trade-journal.functions.ts` and MCP `update_trade_outcome`; both write only the
new columns. `performance.ts` reads canonical R, filters by `r_basis`, returns
`mixed_basis` instead of averaging. MCP `get_performance_summary` /
`list_my_trades` emit `r_basis` and `r_availability`; tool names and schemas stay
stable, only descriptions change, and the word "verified" is replaced by the
ladder. `get_admin_intelligence` returns legacy **and** canonical blocks.
`export.ts`, `history.tsx`, `SignalCard.tsx` label legacy rows as legacy.
`user-audit.functions.ts`: `preset_r_value` scoped to unpriced rows,
`r_exceeds_max_r` compared only against `r_vs_plan`.

**Stage 5 — statistics reporting.** Weekly report keeps `z`/`pValue` as
diagnostics, adds day-clustered intervals and evidence-gated wording; fill-rate
denominators use the shared maturity horizon (N9) with `pending_resolution`
reported separately; grades reported separately.

## E. New acceptance criteria

1. Seven R fixtures pass, including the one-sided-price validation error, with
   `r_vs_plan` and `r_vs_actual_risk` asserted separately.
2. No **writer** references the legacy columns; allow-listed readers still render
   the 19 legacy rows (N3).
3. `performance.ts` and MCP `get_performance_summary` return non-empty results for
   a canonical-basis trade — the N1/N2 regression test.
4. `get_admin_intelligence` returns both legacy and canonical blocks; app, MCP and
   admin agree on the canonical basis.
5. Mixed sample returns `mixed_basis`, never an average.
6. Two bootstrap runs on the same rows are byte-identical, with stored
   seed/method/version/run_id (N6).
7. Whole-UTC-day cluster fixture: multiple instruments detected on one UTC day
   form exactly one cluster.
8. `actionable` unreachable on current data; a test asserts no prescriptive wording
   at n = 3.
9. DB tests: identical retry accepted, conflicting re-resolution rejected, human-win
   vs agent-loss race regression, TS enums equal SQL CHECK lists.
10. Cost provenance: monetary-only costs leave `net_r` NULL and no cost-adjusted
    claim appears anywhere.
11. Zero change to signal count, grade distribution, alerts, webhook dispatches or
    MetaApi request volume; full `bun run verify` green (421 baseline).

## F. Remaining risks

Self-reported prices can still be untrue; the honest output at current sample
sizes reads "insufficient" nearly everywhere; the legacy/canonical dual display
adds UI surface the owner must interpret; the trigger's conflict rule could reject
a legitimate late correction until the correction workflow exists.

## G. Confidence

**High** on the R mathematics and on N1/N2/N4 being real blockers — all are proven
by specific lines at HEAD. **High** that no trading-model change is smuggled in.
**Medium** on the statistics layer's product reception, since almost every panel
will read "insufficient". **Low** on holdout value today: it ships as machinery.

## H. What still cannot be guaranteed

Corrected R will not reconcile against broker P&L (no source exists); no method
rescues small samples; and with 0 priced rows today the production effect of the R
correction can only be proven by fixtures, not measured.
