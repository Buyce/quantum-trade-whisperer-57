# Red-Team Review + Revised Plan: Statistical Standard & Journal Mathematics

Reviewed against repository HEAD and live data. The first plan survives in outline but had four material defects. It is revised below.

## A. Plan defects discovered

1. **I invented an evidence level the data can never reach.** I proposed an `evidenced` tier gated on ≥10 distinct detection days per side. Live production replays span **8 distinct days total** across three instruments. The tier would be permanently unreachable — dead code that implies a promotion path we cannot honour.
2. **Duplicated statistical vocabulary.** `payoff_stats` already carries a project standard: `stat_status` ∈ `unavailable | insufficient_coverage | insufficient_sample | descriptive`, with a coverage threshold and an explicit `reason`. My new four-level vocabulary would be a second, conflicting language for the same idea.
3. **The R redesign, as written, was a net integrity regression.** Planned risk (`|signal.entry − signal.stop|`) is scanner-written and tamper-proof. A self-reported `actual_initial_stop` is typed by the user or an agent, so making it the denominator hands anyone a lever to shrink risk and inflate R — the exact behaviour the integrity audit exists to catch. Collapsing both into one `realized_r_multiple` destroys the distinction.
4. **False UI wording and an incoherent unit.** `broker_verified` would be awarded for a user-typed ticket string — the label would be a lie. `costs_r` asks the user for costs already expressed in R, which is circular; costs are known in price/currency.
5. Smaller: `ShadowRow` has no `detected_at`, so any day-clustered statistic needs an additive query and type change; the weekly email template and `weekly.test.ts` read `z`/`pValue` and would break on a reshaped report; Benjamini–Hochberg across two tests is statistical theatre.

## B. Revised plan

### B1. One statistical vocabulary, extended — not a new one

Adopt `payoff_stats.stat_status` as the project-wide standard and extend it with `insufficient_clusters`. Every reported figure carries `{ value, interval, n_used, cluster_n, stat_status, reason }`. No metric may render without its status. Remove the `evidenced` tier entirely: nothing in this system currently earns a causal claim, and the report should say so.

- Proportions → **Wilson score intervals** (correct at small n, never leaves [0,1]).
- Mean R → **day-cluster bootstrap** (detection day is the cluster), reporting `cluster_n` alongside. With 8 clusters the interval will be wide; that is the true answer, and the report states that ≥ ~20 clusters are needed before the interval is worth acting on.
- Keep `z` and `pValue` as clearly-labelled secondary diagnostics that assume independence. **Additive change only** — the email template and existing tests keep working.
- Drop multiplicity correction from scope; with a two-metric registry it adds no protection. Instead, commit a registry file listing the comparisons the weekly report is permitted to compute at all, so post-hoc metrics cannot be added silently.
- `src/lib/performance.ts` prescriptive insights move from n ≥ 3 to n ≥ 30; below that the page shows sample size, interval, and "no conclusion available".
- Isolation repairs: add `cohort = 'production'` to `weekly.server.ts`, `user-audit.functions.ts`, `signal-audit.functions.ts`; delete the duplicated `replay_version` filter; add a test that fails when a production aggregate omits the cohort boundary.

### B2. Two R numbers, never one

Store both, label both, never merge:

- **`r_vs_plan`** — denominator `|signal.entry − signal.stop|`, numerator the user's actual fill and exit. Tamper-proof denominator, so this is the only R that feeds engine-facing aggregates and the integrity audit.
- **`r_vs_actual_risk`** — denominator `|actual_entry − actual_initial_stop|` when the user records their real stop. This is the trader's own P&L truth, shown on the journal and performance pages, explicitly labelled self-reported.
- `realized_r_multiple` stays the canonical engine number and is set from `r_vs_plan` only. `reported_r` (whatever the user originally claimed) is never overwritten.

New nullable columns: `actual_initial_stop`, `actual_entry_at`, `actual_exit_at`, `broker_reference`, `costs_price` (price units, not R). Owner-scoped RLS and grants follow the existing table pattern. **No backfill** — the 19 closed, price-less rows stay unverified and no historical R is recomputed.

### B3. Verification levels that don't overclaim

`unverified` → `self_reported` (entry + exit; plan risk used) → `plan_verified` (replay confirms the fill and exit were reachable) → `contradicted` (replay says impossible) → `pending` (replay unresolved). `broker_verified` is deleted; a typed ticket is stored as `broker_reference` metadata and never upgrades a level. Trust score and verified win rate are computed at `plan_verified`, with the level distribution shown beside them and a standing caveat that journal rows are self-selected and are not the strategy's win rate.

### B4. Shared helper and re-log fix

One pure R function (`plan` and `actual_risk` variants) plus a thin server wrapper, called by both `recordTradeOutcome` and the MCP `update_trade_outcome`, so the paths cannot drift. Both decision writers stop touching outcome state: on conflict they update decision fields only. A separate explicit reopen clears prices, both R values, provenance and level in one statement. MCP compatibility is preserved: `verified` stays a boolean meaning "level ≥ plan_verified", with the new `verification_level` added alongside.

## C. Major decisions — challenged

**Two R columns rather than one corrected R.** *Why:* it fixes the real defect (planned entry as numerator anchor) without surrendering a tamper-proof denominator. *Alternatives:* (1) single actual-risk R — rejected, self-reported denominator becomes the engine's number and inflating R becomes trivial; (2) leave R as-is and only document it — rejected, a worse-than-planned fill is genuinely mis-measured today. *Evidence:* 0 of 19 closed trades have prices, so nothing is broken by changing the definition now; the audit already exists specifically to catch unverifiable R. *Would change my mind:* broker-API-sourced fills, which would make actual risk verifiable and collapse the two into one.

**Extend `stat_status` instead of a new evidence vocabulary.** *Why:* one language, already deployed and tested. *Alternatives:* (1) my original four-level scheme — rejected as duplicated logic with an unreachable top tier; (2) raw p-values as today — rejected, `significant` at p<0.05 on 8 clustered days is unsound. *Evidence:* grade A has n=3/1 filled, B 249, C 86 over 8 days — clustered and unbalanced. *Would change my mind:* several months of data giving ≥20 clusters per side.

**Day-cluster bootstrap over a t-interval.** *Why:* overlapping plans on three instruments are not independent; day clustering is the minimum honest correction. *Alternatives:* (1) plain t/normal interval — rejected, understates width; (2) instrument-and-week clustering — rejected for now, too few clusters to estimate. *Evidence:* 338 resolved rows across 8 days. *Would change my mind:* evidence that same-day plans are near-independent.

## D. Three failure scenarios it must survive

1. **Agent shrinks the stop to fake a winner.** An assistant writes `actual_initial_stop` 3 pips from entry. `r_vs_actual_risk` inflates, but `realized_r_multiple` and every engine aggregate use plan risk, the audit sees an actual/plan risk ratio far below 1 and flags it, and the level stays `self_reported`. No engine metric moves.
2. **Re-log during an open browser tab.** A user re-clicks "taken" on an already-resolved trade while an agent updates its outcome. The decision writer no longer touches outcome, prices, or R, so the concurrent update wins intact — today this silently reopens the trade and leaves stale prices attached to `outcome = 'open'`.
3. **Weekly cron runs on a week with 1 resolved row and research enrolment switched on.** Cohort filter excludes research rows; Wilson interval spans nearly [0,1]; status is `insufficient_clusters`; the email renders the status and no rate as a headline; `z`/`pValue` stay `n/a`; the send latch still fires exactly once.

## E. New acceptance criteria

- No metric renders anywhere without a status and sample size; no "significant" verdict is emitted by any code path.
- `realized_r_multiple` equals `r_vs_plan` for every row; no row's `reported_r` is mutated by the migration.
- Long and short cases with worse-than-planned fills produce the correct sign and magnitude for both R variants.
- Re-logging a decision leaves outcome, prices, R and level byte-identical; reopen clears all of them together.
- A test fails if any production aggregate query omits `cohort = 'production'`.
- MCP `update_trade_outcome` still returns a `verified` boolean; `list_my_trades` keeps its existing fields.
- Zero change to scanner logic, grading, MetaApi calls, or published signal count.

## F. Remaining risks, confidence, and what cannot be guaranteed

**Risks:** journal rows stay self-selected, so no journal statistic generalises; the day-cluster interval is itself estimated from 8 clusters; adding columns to `executed_trades` widens the surface an agent can write; wording changes will make the report look weaker to a reader who preferred the old confident verdicts.

**Confidence: medium-high** on the journal mathematics and the isolation repairs — those are verified defects with local, testable fixes. **Medium** on the statistics, because the right interval width is a judgement call that data this sparse cannot settle.

**Cannot be guaranteed:** that any self-reported fill price or stop is true (no broker feed); that a wide interval will not be read as a point estimate; that historical rows written under the old R definition are comparable to new ones — they are marked, not repaired.
