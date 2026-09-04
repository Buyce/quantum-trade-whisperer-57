# ML Model Readiness Audit — P-Trades Hub

## Verdict (from live data, audited 2026-09-04)

**No ML model exists, and the data is not ready to train one.** The infrastructure for evidence collection is in place, but every readiness gate we engineered is currently failed. Training now would fit noise.

## Readiness criteria vs. actual state

| Gate | Required | Actual (live DB) | Status |
|---|---|---|---|
| Trained model exists | calibrated fitted predictor | none — fixed truth-table grading + manual overrides only | ABSENT |
| Matured labelled samples (production) | ≥200 per arm per slice | A: 3, B: 167, C: 131 (total ~301 over 17 trading days) | FAIL — A arm nearly empty |
| Research-cohort matured outcomes | ≥200 matured | 568 enrolled shadow rows, **0 matured** (390 unresolved, 178 outside replay window) | FAIL |
| ML target labels | labelled training rows | production: 165 positive / 901 negative; research: 568 unlabelled | PARTIAL — research arm contributes nothing yet |
| Time span | ≥20 trading days | 17 trading days (2026-08-11 → 2026-09-03) | FAIL — close |
| Feature/decision log | present | 7,211 model_observations (2,175 candidate / 5,036 no_trade) since 2026-08-21, with instrument, grade, direction, family, provenance | PASS |
| Payoff/regime statistics | computed | 252 payoff snapshots, 14 payoff_stats rows | PASS (infrastructure) |
| Governance rails | present | proposals=0, overrides=0, 3 model versions | READY — unused, as designed |
| Filter-lift evidence | non-overlapping 95% CIs, ≥30 mature/arm | 0 rows in filter_lift_stats (recompute has produced no qualifying rows) | FAIL — arms too immature |

## Why the research arm has zero matured outcomes

- 178 of 568 enrolled rows are `outside_replay_window` (detected before the stored-candle horizon; labelled, never synthesised — correct behavior).
- 390 are unresolved: enrolment began 2026-09-03; replays need the 24h terminal horizon plus candle coverage to resolve. This fixes itself with time, not code.

## What this means

1. The scanner learns nothing automatically today — by design. "Learning" = measurement (grade calibration, filter lift, learning evidence panels).
2. Earliest defensible readiness: research-cohort rows maturing over the next days + production accruing to ≥200 mature/arm and ≥20 trading days. On current fill rates (~35% of shadow rows fill and resolve), that is roughly 1–3 weeks away for B/C arms; the A arm is too rare to estimate.
3. No code fix is required. The bottleneck is sample maturity, not engineering.

## Proposed actions (optional, measurement-only)

1. **Readiness panel** — add a small "Model readiness" section to Admin Intelligence showing the gate table above computed live (matured counts per arm/slice, trading days, filter-lift status), so readiness is visible without SQL.
2. **Maturity tracker** — weekly check of research-cohort resolution rate and outside-window share; alert if unresolved share stays high after 7 days (would indicate a replay-pipeline issue, not a data issue).
3. **No model training, no threshold changes** until all gates pass; keep current replay/broker separation unchanged.

## Explicitly out of scope

- No trained model, no automatic threshold adaptation, no grade changes.
- No use of broker P/L for rejected candidates (impossible — never sent; replay-only by design).
