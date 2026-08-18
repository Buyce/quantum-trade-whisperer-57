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

## 7. Implementation phases

- **Phase 0 — Fill diagnostic.** A read-only analysis of the 49 never-filled rows: distance from entry at TIF expiry, distribution by instrument and session. Output is a written finding on whether the entry offset or the 30-minute TIF is the binding constraint. No schema change.
- **Phase 1 — Schema.** `regime_stats` table (service-role writes, authenticated read for the UI), `recompute_regime_stats()` SECURITY DEFINER function, ATR-tercile boundaries stored per instrument. Grants and RLS in the same migration.
- **Phase 2 — Recompute wiring.** Call the recompute at the end of `src/routes/api/public/cron/shadow-resolve.ts`, after resolution, inside its existing error boundary so a stats failure never fails resolution.
- **Phase 3 — Read path (shadow mode).** `src/lib/learning/regime.server.ts` exposes the hierarchical lookup; `pipeline.server.ts` writes `p_fill_prior`, `p_win_prior`, `ev_prior`, `prior_sample_n` onto each new signal. Grading logic unchanged.
- **Phase 4 — Surfacing.** An "Intelligence" panel showing per-regime sample counts, shrunk win/fill rates, and a clear "learning — insufficient sample" state. Read-only.
- **Phase 5 — Activation (separate approval).** Only after Phase 4 has run long enough to satisfy the gate, and only with a measured Brier-score improvement over the heuristic.

## 8. Explicitly out of scope

No Python, no external microservice, no external ML API, no seeded or synthetic training rows, no change to the 15-minute cron cadence, no change to the live feed queries or the daily cap.

## Technical notes

- Volatility terciles derive from `market_context.volatility_index` (populated for all 68 rows) plus `scanned_signals.atr`, computed per instrument to avoid cross-instrument scale error.
- Session comes from `market_context.trading_session`; `time_of_day` / `day_of_week` are held back as candidate features, not used at this sample size.
- Purging must not corrupt the dataset: the tiered retention job deletes `scanned_signals` rows, and `shadow_executions.signal_id` is an FK to them. Phase 1 verifies the FK's delete behaviour and, if it cascades, snapshots the needed feature columns onto `shadow_executions` so the training set survives retention.
- Recompute reads only rows with `status = 'resolved'`, so in-flight replays can never leak partial outcomes into the priors.
