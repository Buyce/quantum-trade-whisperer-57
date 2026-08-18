# Native In-App Learning Engine — Architectural Audit

## 1. The blocking finding: there is not enough data to train either model

Measured against the live `shadow_executions` table right now:

| Metric | Value |
| --- | --- |
| Resolved rows | 68 |
| Actually filled (tradable outcomes) | 19 |
| Wins (`ml_target_label = 1`) | 7 |
| Never filled | 49 (72%) |
| Grades present | B (65), C (3) — zero A, zero A+ |
| Instruments | XAUUSD 39, EURUSD 26, GBPAUD 3 |

Your Option A example bucket — `EURUSD + London + High Volatility` — would resolve to roughly **two** filled samples. Option B would fit 4-6 weights to 19 observations with 7 positives, which is a memorised dataset, not a model.

So the honest verdict on both options as stated: **neither is trainable this month.** Anything that claims a win-rate today is noise wearing a lab coat. The architecture below is therefore built to accumulate correctly now and switch on automatically when the sample size justifies it — never before.

## 2. The dominant learnable signal is not win rate — it is fill rate

72% of setups never filled. That single number swamps every win-rate refinement: the algorithm's largest measurable defect is that its limit entries are placed where price does not return within the time-in-force window. A win-rate model conditioned only on filled trades would also be **selection-biased** — it learns from the subset of setups where price behaved a specific way, and silently ignores the 72% majority.

Correct treatment is two separate models, in this order of priority:

1. `P(fill)` — trainable on all 68 rows today, directly actionable (entry offset, TIF length).
2. `P(win | filled)` — needs far more data; parked behind a gate.

Final score for a live setup: `P(fill) x P(win | filled)` — the expected-value decomposition, not a single conflated probability.

## 3. Model choice: Option A wins, but not as you specified it

**Option B (online logistic SGD) is rejected**, for reasons beyond sample size:

- FX regimes are non-stationary. Online SGD with a fixed learning rate silently forgets or over-weights the most recent regime, and there is no audit trail explaining why a weight moved. You cannot answer "why did this setup score 0.61?" six weeks later.
- Our candidate features (`c_alignment`, `p_trend`, `p_momentum`, `atr`, `rr_ratio`) are strongly collinear by construction — they are derived from the same three timeframe reads. Logistic regression on collinear inputs produces unstable, sign-flipping coefficients at small N.
- The serverless-cost question you raised is the least of the problems: SGD over 10k rows in TypeScript is milliseconds. Feasibility was never the objection; auditability and overfitting are.

**Option A is adopted with a correction:** flat bucketing plus Laplace smoothing is still too crude, because it treats every bucket as unrelated. The correct standard (as used in sports/insurance credibility models) is a **hierarchical Beta-Binomial shrinkage estimator** — each bucket is shrunk toward its parent, not toward a single global mean:

```text
tier 3  instrument x direction x session x volatility bucket
   shrinks toward
tier 2  instrument x direction
   shrinks toward
tier 1  global
```

Posterior mean at each tier:

```text
p_hat = (wins + k * p_parent) / (n + k)        k = 30 (prior strength)
```

With `n = 2`, the estimate is 94% parent; with `n = 300`, it is 91% own data. There is no cliff at N=30 and no bucket ever returns a wild 0.0 or 1.0. Volatility is discretised into three ATR-percentile terciles per instrument (not absolute thresholds — gold and EURUSD do not share a scale).

## 4. Database architecture: neither a MATERIALIZED VIEW nor triggers

You are right that plain `REFRESH MATERIALIZED VIEW` takes an `ACCESS EXCLUSIVE` lock and blocks reads. `CONCURRENTLY` avoids that but requires a unique index and does a full diff on every refresh. Trigger-based rolling aggregates are worse: every shadow resolution would contend on the same aggregate row, serialising writes and risking deadlock against the resolver's own updates.

Adopted design — a **plain table, single-writer, full recompute inside one transaction**:

- `regime_stats` — one row per (tier, key), holding `n`, `wins`, `fills`, `p_win_shrunk`, `p_fill_shrunk`, `computed_at`.
- Recomputed by a SECURITY DEFINER SQL function called at the end of the existing hourly `shadow-resolve` cron: a single `INSERT ... ON CONFLICT DO UPDATE` from an aggregate `SELECT`. One statement, one transaction, no lock held against readers (MVCC gives readers the previous snapshot).
- Only one writer exists — the cron — so there is no race condition to design around. The live scanner is read-only against this table and never writes it.

**Load dry-run at 10,000 resolved executions:** the aggregation scans 10k rows (a few ms with an index on `(status, instrument, detected_at)`) and produces roughly **60-120 rows** of output — 3 instruments x 2 directions x 4 sessions x 3 volatility terciles, plus parent tiers. The live lookup is a primary-key hit against a table that fits in a single page: sub-millisecond, and the scanner reads all rows once per scan cycle into memory anyway. Latency spikes on the live feed are structurally impossible because the feed never touches this path — it reads `scanned_signals` as it does today.

## 5. Data flow

```text
shadow_executions (resolved rows only, replay-labelled)
        │  end of hourly shadow-resolve cron
        ▼
recompute_regime_stats()   one transactional upsert, ~100 rows out
        ▼
regime_stats  ◄── read once per scan cycle by pipeline.server.ts
        │
        ▼
new signal: p_fill_prior, p_win_prior, ev_prior written onto scanned_signals
            (advisory columns — grade and confidence_score untouched)
```

## 6. Governance: shadow mode first, and a hard activation gate

The empirical scores are **recorded but not acted upon** at first. `grade`, `confidence_score` and the daily cap keep their current heuristic behaviour. This lets us measure, on real forward data, whether the prior actually predicts before it is allowed to suppress a single setup.

Activation criteria, enforced in code, per tier:

- `P(fill)` may influence entry guidance once its tier has **n >= 150** resolved rows.
- `P(win | filled)` may influence grading once its tier has **n >= 200 filled** rows and beats the current heuristic's Brier score on a held-out window.

Until then the function returns the parent estimate and the UI labels it "insufficient sample" rather than showing a fake percentage. This respects the zero-hallucination rule: no synthetic rows, no invented probabilities, and an explicit empty state when the data is not there.

## 7. Phase 0 result (already measured)

The fill diagnostic is done. Non-filled setups were replayed for an average of only **1.7-1.9 M15 bars** before the time barrier closed them, and both MFE and MAE were **0.000R** — price never moved toward the entry at all within the window. GBPAUD's three rows replayed 0 bars (no candle coverage at detection time).

Conclusion: the binding constraint is the **30-minute time-in-force**, not the entry offset. Two M15 bars is not enough time for a retracement entry to be revisited. Non-fills also cluster in Tokyo (19 of 27) and Sydney (9 of 10) — the low-liquidity sessions — while London fills best (9 of 23 filled).

This is recorded as a finding only; changing the TIF is a separate decision and is **not** part of this build.

## 8. Implementation phases

- **Phase 1 — Schema + retention safeguard.** Snapshot `trading_session`, `volatility_index` and `atr` directly onto `shadow_executions`. The `signal_id` foreign key is currently `ON DELETE CASCADE` (verified), so tiered pruning would delete the training set — it is changed to `ON DELETE SET NULL` with `signal_id` made nullable, so telemetry rows outlive the signals they came from. Adds the `regime_stats` table (authenticated read, service-role write, RLS on) and the `recompute_regime_stats()` SECURITY DEFINER function with `k = 30` shrinkage and per-instrument ATR terciles, execute granted to service role only. Adds advisory `p_fill_prior`, `p_win_prior`, `ev_prior`, `prior_sample_n` to `scanned_signals`. Existing 68 rows get their snapshot columns backfilled from `market_context`, and the shadow worker is updated to write them on every future enrolment.
- **Phase 2 — Recompute wiring.** Call `recompute_regime_stats()` at the end of `src/routes/api/public/cron/shadow-resolve.ts`, after resolution, inside its own guard so a stats failure never fails resolution.
- **Phase 3 — Read path (shadow mode).** `src/lib/learning/regime.server.ts` performs the tier-3 → tier-2 → tier-1 hierarchical lookup; `pipeline.server.ts` loads the ~100-row table once per job and writes the three priors plus sample count onto each new signal. `ev_prior = p_fill x p_win`. Grade, `confidence_score` and the daily cap are untouched.
- **Phase 4 — Intelligence Panel.** A read-only block inside the expanded `SignalCard.tsx` showing the fill prior, win prior, expected value and the sample size behind them, with an explicit "learning — insufficient sample" state below the gates. No fabricated percentages.
- **Phase 5 — Activation gates (hardcoded now, dormant).** `MIN_N_FILL = 150` and `MIN_N_WIN = 200` are constants in the read path from day one; below them the value is displayed as advisory and can influence nothing. Flipping them to influence grading is a separate, later approval.

## 9. Explicitly out of scope

No Python, no external microservice, no external ML API, no seeded or synthetic training rows, no change to the 15-minute cron cadence, no TIF change, no change to the live feed queries or the daily cap.


## Technical notes

- Volatility terciles derive from `market_context.volatility_index` (populated for all 68 rows) plus `scanned_signals.atr`, computed per instrument to avoid cross-instrument scale error.
- Session comes from `market_context.trading_session`; `time_of_day` / `day_of_week` are held back as candidate features, not used at this sample size.
- Confirmed by query: the `shadow_executions.signal_id` FK is `ON DELETE CASCADE` today, so tiered retention would silently destroy the training set. Phase 1 changes it to `ON DELETE SET NULL` and snapshots the feature columns onto the row.
- Recompute reads only rows with `status = 'resolved'`, so in-flight replays can never leak partial outcomes into the priors.
