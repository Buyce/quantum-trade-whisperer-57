# Redesign the Learning Engine's "Expected Value"

## 1. Actual goal

P-Trades must tell a trader what a setup is worth in R, with honest uncertainty, or say
"insufficient data". Today it multiplies two probabilities and calls the product
"Expected value" — an economically meaningless quantity.

## 2. Current implementation (re-read at HEAD)

- `src/lib/learning/regime.ts` — `summarize()` sets `ev = pFill * pWin`; `clamp01()` returns
  **0.5** for non-finite input; gates are fixed `MIN_N_FILL = 150`, `MIN_N_WIN = 200`,
  `MIN_N_TIER3 = 20`.
- `recompute_regime_stats(mv)` (latest migration `20260821071943…`) computes fill/win rates
  only, shrinks with k = 30, and defaults the global prior to **0.5** when a denominator is 0.
  No payoff (R) statistic exists in `regime_stats` / `regime_snapshots` at all.
- `pipeline.server.ts` writes `p_fill_prior`, `p_win_prior`, `ev_prior` onto `scanned_signals`.
- `SignalCard.tsx` shows a tile literally labelled **"Expected value"** with subtitle
  "fill x win", plus an `EV` chip in the collapsed row gated on `prior_sample_n >= 150`.
- `feed.tsx` offers **sort "by exp. value"**, gated only on the *fill* sample count — so the
  ranking uses the win term before the win gate has passed.
- `get-intelligence.ts` (MCP) returns `expected_value: prior.ev` to AI agents.
- Regime keys are `instrument|direction|session|vol_bucket` — **no grade, no strategy family,
  no execution policy**. Statistics are model-version-scoped only.
- `weekly.server.ts` computes a genuine `expectancyR` from realized R; the admin RPC reports
  mean R. Those two are correct and disagree with the "EV" tile by an order of magnitude.

Live data (model 1, replay 1, resolved = 329): fill 94 (28.6%), win|filled 48/94 (51.1%),
mean R|filled **+0.0149**, unconditional mean R **+0.0043**. The tile currently displays
0.286 x 0.511 = **14.6%**, which a trader reads as an edge. The measured edge is ~0.004R,
statistically indistinguishable from zero.

## 3. Affected surface

Tables/functions: `regime_stats`, `regime_snapshots`, `scanned_signals`, `shadow_executions`,
`recompute_regime_stats`, `get_admin_intelligence`, `baseline_snapshots`.
Code: `learning/regime.ts`, `regime.server.ts`, `explain.ts`, `milestone.server.ts`,
`scanner/pipeline.server.ts`, `queries.ts`, `SignalCard.tsx`, `LearningHistory.tsx`,
`feed.tsx`, `mcp/tools/get-intelligence.ts`, `reports/weekly.server.ts`,
`baseline/capture.server.ts`, plus `learning/__tests__/regime.test.ts` (which currently
*pins* `ev = pFill*pWin`).

## 4. Confirmed defects

1. **D1 — Mislabelled statistic.** `pFill x pWin` is P(fill AND win), a probability, rendered
   as a percentage "expected value". Not a return.
2. **D2 — Payoff ignored.** No loss magnitude, no expiry/timeout leg, no cost. V1 wins pay
   0.65R–2.0R (ladder), Replay-V2 policy pays exactly 1R; the same probabilities imply
   different expectations under the two policies.
3. **D3 — Fail-open defaults.** `clamp01` → 0.5 and the SQL `g_pfill/g_pwin` → 0.5 invent a
   coin flip where data is missing. Violates the zero-hallucination rule.
4. **D4 — Ranking gate wrong.** EV sort and the EV chip gate on resolved samples only; the
   win term can be almost entirely borrowed prior.
5. **D5 — Pooling across incomparable strategies.** A+, B and C share one bucket. Measured
   mean R|fill by grade: B +0.017, C **−0.048**, A n=1. Pooling hides a negative cohort.
6. **D6 — Precision unreported.** A single 4-dp number with no interval; tier-3 buckets hold
   a median of ~2 filled samples (max 9), so nothing at tier 3 can support a payoff estimate.

## 5. Hidden/secondary risks found

- `regime_snapshots` has no R columns, so any new statistic has **no history** — the learning
  chart would start empty; must be stated in the UI, not backfilled.
- `explain.ts` builds its shrinkage ladder from fill/win only; adding an R term without
  updating it makes the explain drawer inconsistent with the headline number.
- `milestone.server.ts` emails on the 150/200 gates; changing gate semantics silently changes
  who gets emailed and when — needs its own claim key so no duplicate email fires.
- Replay-V2 siblings exist in `shadow_executions`. Any R aggregate **must** filter
  `replay_version = 1` or research rows will contaminate production expectations.
- `recompute_regime_stats` DELETEs and re-INSERTs per model version in one transaction; adding
  columns is safe, but the hourly cron and a manual admin call can overlap — the existing
  transaction boundary is the only guard, and there is no advisory lock.
- Non-finite guard order: SQL `numeric` cannot hold NaN/Infinity, but JS division by 0 can, so
  the guard must live in TypeScript too.

## 6. Alternatives

**A. Empirical mean realized R per regime.** Simple, unbiased, matches the weekly report.
Drawback: variance is brutal at n≈90 (sd of R|fill ≈ 0.7 → SE ≈ 0.07R, CI wider than the
signal); tier-3 unusable. Complexity low. Rejected as the *only* estimator, kept as the
audit reference.

**B. Decomposed P(fill) x E[R|fill] with each part shrunk.** Keeps the fill/win decomposition
the product already exposes, isolates the two evidence gates, and lets P(fill) go active while
payoff stays "insufficient data". Complexity moderate. Requires an R-moment aggregate in SQL.
**Recommended.**

**C. Full Bayesian hierarchical model of R (MCMC/Stan-style).** Best uncertainty treatment.
Drawback: no sampler is available in a Cloudflare Worker; it would need an external service.
Rejected on runtime grounds, not statistical ones.

**D. Bootstrap of shrunken empirical expectation.** Honest non-parametric intervals, no
normality assumption. Drawback: needs raw rows per regime at read time (the scanner currently
reads one small aggregate table); 1k resamples per bucket per scan is the wrong cost profile.
Rejected for the live path; **kept as the offline validator** that checks B's intervals.

Chosen: **B, with normal–normal (James–Stein-style) shrinkage of E[R|fill] toward the parent
tier, and D as an offline audit.**

## 7. Recommended architecture

- `EV_R = pFill_shrunk x E[R|fill]_shrunk`, in R units, with a variance and a Wilson/delta
  confidence interval; `null` whenever any input is missing or non-finite.
- Rename the old quantity everywhere to **`joint_win_probability`** (`p_joint`). It stays
  visible (it is a real probability) but is never called EV again.
- Statistics are keyed by `(model_version, replay_version, execution_policy, grade_band,
  instrument, direction, session, vol_bucket)`. Grade band = `A_PLUS_A | B | C`.
- **Precision gate** replaces the bare fixed N: a statistic is "active" only when
  `n >= n_floor` **and** the 95% CI half-width is under a published budget
  (fill: 0.10 absolute; E[R|fill]: 0.15R). Fixed N stays as a floor because a CI can be
  narrow-by-luck at tiny n.
- Fail-closed: no 0.5 defaults; `unavailable` with a reason code.
- V1 production keeps writing `ev_prior` untouched for historical identity; the new columns are
  additive and start `NULL`.

## 8. Derivation

Let F = fill indicator, R = realized R (0 when unfilled).
`E[R] = P(F=0)*0 + P(F=1)*E[R|F=1]`.
`E[R|F=1] = p_win*E[R|win] + p_loss*E[R|loss] + p_expiry*E[R|expiry]` — the current formula is
the special case `E[R|win]=1, E[R|loss]=0, expiry ignored`, which is false on both counts.

Live numbers: `E[R|F=1] = (48(0.9875) + 46(−1) + 0)/94 = +0.0149`;
`EV_R = 0.286 x 0.0149 = +0.0043R`. Variance: `sd(R|fill) ≈ 0.70`, `SE ≈ 0.072`, so
`CI95(E[R|fill]) ≈ [−0.13, +0.16]` → half-width 0.145R, just inside a 0.15R budget at the
global tier and hopelessly outside it at tier 2/3.

Shrinkage of the payoff mean: `Ê = (n_f x m_child + k_R x m_parent)/(n_f + k_R)` with
`k_R = sd_parent^2 / between-bucket variance`, floored at 20 filled samples.

**Higher win probability ≠ higher expected R** (hand-calculated):
- Regime X: pFill 0.40, pWin 0.60, payoff 1R win / −1R loss → `E[R|fill] = 0.2`,
  `EV_R = +0.080R`. p_joint = 0.24.
- Regime Y: pFill 0.40, pWin 0.45, ladder payoff `E[R|win] = 1.8` → `E[R|fill] = 0.26`,
  `EV_R = +0.104R`. p_joint = 0.18.
  Y ranks **below** X on today's "EV" and **above** it on real expected R.
- Regime Z: pFill 0.90, pWin 0.55, but 30% of fills expire at −0.4R →
  `E[R|fill] = 0.55(1) + 0.15(−1) + 0.30(−0.4) = +0.28`… while the same win rate with
  expiries at −0.9R gives `−0.02` — a losing regime with an attractive-looking win rate.

## 9. Database changes (all additive)

- `regime_stats` + `regime_snapshots`: `n_filled_r`, `mean_r_filled`, `sd_r_filled`,
  `mean_r_filled_shrunk`, `ev_r`, `ev_r_se`, `ev_r_lo`, `ev_r_hi`, `payoff_gate_passed`,
  `grade_band`, `replay_version`, `execution_policy`, `stat_status` (`active|learning|unavailable`).
- Widen the uniqueness key to include `grade_band`, `replay_version`, `execution_policy`.
- `scanned_signals`: `p_joint_prior` (copy of the old semantic), `ev_r_prior`, `ev_r_lo_prior`,
  `ev_r_hi_prior`, `payoff_sample_n`, `ev_status`. `ev_prior` is **frozen, never rewritten**.
- `recompute_regime_stats`: add the R moments (`avg`, `stddev_samp`, count over
  `resolved_outcome <> 'never_filled'`), filter `replay_version = 1`, drop both `0.5`
  fallbacks in favour of `NULL`, and group by grade band. Add an advisory lock.

## 10. Backend changes

`regime.ts`: `RegimePrior` gains `pJoint`, `evR`, `evRLo`, `evRHi`, `payoffN`, `status`;
`clamp01` returns `null` instead of 0.5; new `precisionGate()` helper. `regime.server.ts` selects
the new columns. `pipeline.server.ts` writes the new columns alongside the frozen ones.
`explain.ts` gains the payoff ladder row. `milestone.server.ts` gets a third gate
(`payoff`) with its own claim key. `capture.server.ts` records the new fields.
`weekly.server.ts` cross-checks: report `expectancyR` vs `ev_r` and flag divergence > 0.05R.

## 11. Frontend changes

- SignalCard tile: "Expected value / fill x win" → **"Joint win probability"**; a new
  **"Expected R"** tile showing `+0.08R` with its interval and `Insufficient data` when gated.
- Collapsed-row chip: only when `ev_status = 'active'`; label `EV +0.08R`, never a percentage.
- `feed.tsx`: EV sort ranks by the **lower confidence bound** of `ev_r`, and the button is
  disabled with an explanation until the payoff gate passes; copy updated (currently claims
  "ranks by measured fill x win rate").
- `LearningHistory.tsx`: third gate row and the R series (empty until data accrues, labelled).

## 12. MCP/API

`get_intelligence` payload: keep `p_fill`, `p_win_if_filled`; rename `expected_value` →
`joint_win_probability`; add `expected_r`, `expected_r_ci`, `payoff_sample_n`,
`ev_status`, `execution_policy`, `grade_band`. Breaking rename is deliberate — agents must not
keep reading a number that means something else. Bump the tool description and note it in
the agent instructions page.

## 13. Historical data / versioning

No rewrite of `ev_prior`, `scanned_signals`, `shadow_executions` or existing
`regime_snapshots`. The new statistic is computed forward-only from resolved
`replay_version = 1` rows; grade-banded buckets start empty. Old snapshots stay readable and
are shown as "pre-payoff-model" in the chart.

## 14. Security

All new columns live in already-RLS'd tables; `regime_stats` keeps its read policy,
`baseline_snapshots` stays admin/service-role. `recompute_regime_stats` remains
`SECURITY DEFINER` with `search_path = public` and no new grants. No PII, no secrets in
payloads. MCP exposes aggregates only.

## 15. Performance

One extra aggregate pass in the hourly recompute (bounded by resolved rows, currently 329);
grade banding roughly triples bucket count (~150 rows) — still one small unfiltered select per
scan job. No change to the p95 scan budget. The advisory lock removes the overlap risk.

## 16. Implementation sequence

1. Capture **Baseline C** (section 19) into `baseline_snapshots` — before any migration.
2. Additive migration: columns, widened key, `recompute_regime_stats` v2 (R moments, no 0.5,
   grade band, replay filter, advisory lock).
3. `regime.ts` maths + fail-closed nulls + precision gate, with tests.
4. `regime.server.ts`, `pipeline.server.ts`, `explain.ts`, `capture.server.ts`, milestones.
5. Recompute once; verify old fill/win numbers reproduce bit-for-bit at the global tier.
6. MCP rename; UI rename and new tiles; feed sort switched to lower-bound with a hard gate.
7. Full blocking suite + new suites; update `docs/CHARACTERISATION.md`.

## 17. Test matrix

- **Unit:** `EV_R` from the live cohort → `0.286 x 0.0149 = 0.00426` (±1e-6); X/Y/Z fixtures in
  section 8 → `+0.080R`, `+0.104R`, `+0.28R`; ladder-payoff case proves the ranking flip.
- **Invariant:** `EV_R` sign matches `E[R|fill]` sign; `|EV_R| <= pFill x max|R|`;
  `ev_r_lo <= ev_r <= ev_r_hi`; `p_joint` in [0,1]; every non-finite input → `null` and
  `status = 'unavailable'` (never 0.5); a gate never flips to active with `payoffN < floor`.
- **Property:** shrinkage is monotone in `n_filled` and always lands between child and parent.
- **DB:** migration applies twice idempotently; V1 rows unchanged; research
  `replay_version = 2` rows excluded from every aggregate; RLS unchanged;
  `regime_stats` uniqueness holds under a concurrent double recompute.
- **Regression:** existing `regime.test.ts` EV assertion is *replaced* by a `p_joint`
  assertion; global-tier fill/win values identical pre/post migration.
- **Failure injection:** empty cohort → all `unavailable`; single sample; all-loss cohort
  (negative EV must display as negative, not clamp to 0); NaN volatility; missing
  `mean_r_filled`; recompute killed mid-transaction (no partial `regime_stats`).
- **E2E:** feed EV sort disabled with the payoff gate closed; MCP payload has no
  `expected_value` key; SignalCard shows `Insufficient data`, not `0.0R`.
- **Shadow validation:** offline bootstrap (alternative D) reproduces the analytic CI within
  0.02R on the global tier.

## 18. Failure-mode simulations

Provider outage during recompute (aggregate reads DB only — unaffected); duplicate cron call
(advisory lock, second call is a no-op); stale `scanned_signals` priors after a recompute
(priors are point-in-time by design, documented); partial write (single transaction);
concurrent admin recompute + hourly cron; expired-signal purge removing rows mid-aggregate.

## 19. Baseline C to capture before change

Global and per-(grade band, instrument, direction, session, vol bucket): resolved n, filled n,
fill rate, win-if-filled, mean/sd R|fill, unconditional mean R, never-filled rate, mean
`max_r`, expiry count, plus the current `p_joint` for every open signal, the weekly report's
`expectancyR`, the admin RPC's mean R, and MCP `get_intelligence` output for three fixed
queries. **Data sufficiency:** the global tier supports fill and payoff means (n = 329/94);
tier 2 has at most 32 filled; tier 3 has a maximum of 9 filled and a mean of 1.9 — **no tier-3
payoff estimate is possible today, and none will be fabricated.** Grade A has 1 filled sample:
`A_PLUS_A` will be `unavailable` at launch.

## 20. Deployment / canary

`shadow_engine_state.payoff_model_enabled` (default **off**) controls whether `ev_r` is written
and rendered; the statistic is computed and stored regardless so evidence accrues while the UI
still shows the old wording. Renames (D1 wording, MCP key, sort gate) ship **on**, because
they remove a false claim. Promotion to "active" ranking requires the precision gate to pass
and an explicit flip of the flag.

## 21. Rollback

Flag off → `ev_r` disappears from UI/MCP, nothing is deleted. Wording revert is a code revert.
Migration rollback is forward-fix only: drop-column is avoided; a follow-up migration can
stop populating a column. `ev_prior` is never touched, so V1 identity survives any rollback.

## 22. Acceptance criteria

Nothing in the product calls `pFill x pWin` "expected value"; expected R is in R units with a
published interval; no 0.5 fallback exists in TS or SQL; feed EV sort cannot rank on an
ungated statistic; grade bands are separate buckets; production V1 fill/win numbers and the
weekly report/admin figures are numerically unchanged; blocking suite green.

## 23. Remaining uncertainties

Between-bucket variance for `k_R` must be estimated from thin data and will be re-estimated as
samples accrue. Whether `E[R|fill]` should be computed under Replay-V1 (ladder) or Replay-V2
(single exit) is a policy choice — the plan keys the statistic by execution policy so both can
exist, but production reads V1 until Replay-V2 is promoted. No expiry-exit rows exist in V1
yet, so `E[R|expiry]` is currently unobserved.

## 24. What I cannot guarantee

That the corrected EV will be positive — current evidence says the edge is ~0.004R with a CI
straddling zero. That intervals from a normal approximation are exact at n < 30. That grade
banding will ever produce enough A/A+ samples. That MetaApi candle quality does not bias
`E[R|fill]`. That agents relying on the old `expected_value` key will not break — they will,
intentionally.

## 25. Recommendation

**Proceed, with a modification to your framing:** rename first (it removes a false claim
immediately), compute expected R forward-only behind a flag, and gate on precision rather than
fixed N. Do not backfill, and do not promote EV ranking until the payoff interval is inside
budget.
