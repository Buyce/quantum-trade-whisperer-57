# Statistical Validation Standard + Trade-Journal Mathematics Rebuild

Two linked redesigns. Neither changes the scanner, grading, or shadow replay semantics — they change what we are allowed to *claim* from data, and how a user-reported trade's R is defined.

## What the audit actually found (verified this turn)

Statistics:
- `src/lib/reports/weekly.ts` compares high grades (A+/A) against low grades (B/C) with a two-proportion z-test, `MIN_TIER_SAMPLES = 30`, and emits the verdict `significant` whenever p < 0.05. There is no interval, no multiplicity control, and no independence check.
- Live production replay data: grade A has **3 resolved plans, 1 filled**; B has 249; C has 86 — spread over only **8 distinct detection days**. Plans overlap in time on the same three instruments, so rows are clustered, not independent. A z-test on that structure understates uncertainty.
- `src/lib/performance.ts` starts emitting prescriptive insights at **N = 3** resolved trades.
- `src/lib/reports/weekly.server.ts` carries a comment saying production-cohort only but has **no `cohort` filter**, and repeats `.eq("replay_version", ...)` twice. `src/lib/user-audit.functions.ts` and `src/lib/signal-audit.functions.ts` filter `replay_version = 1` but not `cohort`. Once candidate enrolment is switched on, research rows can leak into the weekly report and the audits.

Journal maths:
- `src/lib/trade-journal.functions.ts` and `src/lib/mcp/tools/update-trade-outcome.ts` both divide by `|planned entry − planned stop|` even when the user reports a different actual fill. A worse fill is then scored against risk the trader never carried.
- There is no column for the trade's **actual initial stop**, actual entry/exit times, broker ticket, or costs — so the real risk denominator is not recorded anywhere.
- `logDecision` (`src/lib/queries.ts`) and the MCP `log_trade_decision` both upsert `outcome: 'open'` on conflict without clearing `actual_entry_price`, `actual_exit_price` or `derived_r`. Re-logging a decision silently reopens a resolved trade and leaves stale prices attached.
- Current state: 25 logged trades, 19 closed, **0 with fill prices** — so no verified row exists yet. This is the right moment to change the definition, before any verified history accumulates.

## Part A — New statistical validation standard

Principle: report an **estimate with an interval and an explicit evidence level**. Reserve the word "significant" for a pre-registered comparison that clears sample, coverage, clustering, and multiplicity requirements. Everything else is descriptive.

1. **Evidence levels replace binary verdicts.** Every reported metric carries one of: `unavailable` (n = 0), `anecdotal` (n < 30), `descriptive` (n ≥ 30, interval shown, no claim), `evidenced` (pre-registered comparison, clustered interval excludes zero after multiplicity control). The UI and email must render the level next to the number, never the number alone.
2. **Intervals, not p-values, as the headline.** Proportions (fill rate, win rate) use Wilson score intervals. Mean R uses a **cluster bootstrap resampling whole detection days**, not individual plans — that is the honest correction for overlapping setups on three instruments. Keep the z-test only as a secondary diagnostic field, clearly labelled as assuming independence.
3. **Multiplicity control.** The weekly report tests several metrics at once; apply Benjamini–Hochberg across the comparison set for that week and report both raw and adjusted values.
4. **Minimum-evidence gates raised and stated.** Comparisons need ≥ 30 per side *and* ≥ 10 distinct detection days per side before any level above `descriptive`. Grade A at n = 3 must render as `anecdotal` with no rate shown as a headline.
5. **Pre-registration file.** A small committed registry lists the comparisons the weekly report is allowed to call `evidenced` (grade tier × fill rate, grade tier × win rate, mean R per plan). Anything not registered can only reach `descriptive`, so we cannot promote a finding discovered after the fact.
6. **Performance-page insights re-gated.** Prescriptive language requires n ≥ 30; below that the page shows the sample count and the interval, and states plainly that no conclusion is available.
7. **Isolation repairs.** Add `cohort = 'production'` to the weekly report and both audit reads, remove the duplicated `replay_version` filter, and add a test that fails if any production aggregate query omits the cohort boundary.

## Part B — Trade-journal mathematics and verification semantics

Principle: a user's R is computed from the risk the user actually carried, and a trade is only "verified" when every input needed to reproduce it is on record.

1. **Record the real risk.** New nullable columns on `executed_trades`: `actual_initial_stop`, `actual_entry_at`, `actual_exit_at`, `broker_ticket`, `costs_r` (optional). Grants and owner-scoped RLS follow the existing table pattern.
2. **New R definition.**
   `risk = |actual_entry − actual_initial_stop|` when the actual stop is recorded; otherwise `|actual_entry − planned_stop|`. The planned entry is never the denominator once a real fill exists.
   `gross_r = signed(exit − entry) / risk`, `net_r = gross_r − costs_r` when costs are supplied.
   Recomputation stays server-side in one shared helper used by both the web journal and the MCP tool — R is still never accepted from a caller.
3. **Graded verification, not a boolean.** `unverified` (no prices) → `self_reported` (entry + exit, planned stop used) → `verified` (entry + actual stop + exit) → `broker_verified` (ticket and timestamps present) → `contradicted` (replay says the fill or exit was impossible). The audit's trust score and verified win rate are computed at the `verified` level and above, with the level distribution shown so a high score built on `self_reported` rows cannot be mistaken for broker evidence.
4. **Decision re-logging stops mutating outcomes.** Both writers upsert only the decision fields; on conflict the outcome, prices, derived R and verification level are left untouched. A separate explicit reopen action clears prices and R together, so an open trade can never keep stale fill prices.
5. **Backfill is honest.** Existing rows get no invented stops. The 19 closed rows with no prices stay `unverified`, and a one-time migration note records that no historical R was recomputed.

## Sequencing

1. Part A isolation repairs and evidence-level plumbing (no user-visible claim upgrades).
2. Part A intervals, cluster bootstrap, multiplicity, pre-registration, UI/email rendering.
3. Part B schema migration plus shared R helper, both writers switched over.
4. Part B verification levels, audit rework, re-logging fix, tests.

## Technical notes

- Wilson intervals and the day-cluster bootstrap live in pure client-safe modules next to `weekly.ts` so they are unit-testable without a database.
- The bootstrap resamples detection days with replacement (2000 draws, fixed seed) so the same input always yields the same interval — required for reproducible reports.
- The R helper is a single pure function plus a thin server wrapper; the MCP tool and `recordTradeOutcome` both call it, so the two paths cannot drift.
- New tests: R correctness for long/short with worse-than-planned fills, verification-level transitions, re-log idempotence, cohort-filter enforcement, and evidence-level gating at n = 3, 29, 30.
