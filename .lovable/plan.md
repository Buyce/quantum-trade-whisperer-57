# Execution Quality & Loss Reduction for the Auto-Trader

## Context

The learning loop already exists: research candidates → shadow replay → filter-lift →
threshold proposals → readiness-gated automatic threshold application. That loop improves
**signal selection**. What it does not yet measure or adapt is **execution quality** —
what actually happens between "signal published" and "broker fill/close".

Current state (verified in code):
- Auto-enqueue (`direct-enqueue.server.ts`) gates on: AutoIntelGate (win-rate + sample),
  `auto_execute_c_grade` toggle (default off), news blackout, spread/slippage/exposure
  ceilings, duplicate prevention, refusal backoff, market-open check.
- Sizing: Model 1 (static) is authoritative; broker-spec dual-run logs divergence.
- Exit policy: `single_exit_first_target` (binding — unchanged by this plan).
- Broker evidence: `broker_trade_evidence` holds real fills/closes with grade provenance.

The recurring loss pattern seen in the demo account (12 losses / 8 wins on recovered
orphans, mostly C-grades) is a **cohort selection and execution-cost problem**, not a
scanner problem. This plan closes that loop with broker-measured evidence only.

## Binding constraints (unchanged)

- No fabricated evidence: every number below comes from `broker_trade_evidence` /
  `execution_deliveries` / `execution_enqueue_decisions`; missing data renders as
  "insufficient evidence", never an assumed value.
- Advisory limits never imply broker state; Model 1 sizing stays authoritative.
- `single_exit_first_target` exit policy stays.
- Live stays OFF; all changes apply to demo first and inherit into live gates.

## Work items

### 1. Execution-quality telemetry (measurement first)
- New view/RPC `execution_quality_stats`: per (symbol, grade, session) cohort compute
  from broker evidence only:
  - **entry slippage**: |broker fill price − signal entry price| in pips
  - **fill rate**: filled deliveries / submitted deliveries
  - **achieved R vs planned R**: realized R-multiple vs the signal's planned R
  - **expectancy in R** over the full payoff distribution (existing payoff math)
- Admin Intelligence panel: "Execution quality" table with sample sizes, Wilson 95%
  intervals, and explicit "insufficient evidence" state under 30 samples.

### 2. Evidence-based cohort gating for auto-execution
Extend AutoIntelGate from a single win-rate check to cohort-aware expectancy gating:
- Auto-execute a (symbol, grade) cohort only when its matured expectancy is positive
  with a lower-95%-CI > 0 R, minimum 30 samples (descriptive) / 200 (full gate).
- Negative-evidence cohorts (lower CI < 0 R) are auto-excluded with a recorded
  `cohort_negative_expectancy` refusal reason — visible in refusal telemetry.
- C-grade auto-execution additionally requires the per-user `auto_execute_c_grade`
  opt-in (existing) AND positive cohort expectancy. C never rides on A/B evidence.

### 3. Per-account loss circuit breaker
- Per (account, symbol): after 3 consecutive broker-confirmed losses, pause new
  auto-orders for that symbol on that account for 24h (persisted, survives restarts).
- Resume is automatic after the window; each pause/resume is audited and shown in
  Admin Intelligence and the account's history page.
- Global kill switches and emergency stop remain untouched and authoritative.

### 4. Evidence-scaled risk (bounded, advisory)
- Risk multiplier per cohort derived from expectancy evidence: 1.0 (full evidence,
  positive), 0.5 (thin evidence 30–199 samples), 0 (negative cohort).
- Hard bounds: never above the user's configured risk %, never below 0; multiplier is
  logged on the delivery (`risk_multiplier`, `risk_multiplier_reason`) for audit.
- Model 1 base sizing is unchanged — the multiplier only scales its output down.

### 5. Order-window and timing tuning from fill evidence
- Where a symbol's fill rate is high but entry slippage is consistently adverse,
  shorten the effective order window within the user-configured
  `auto_order_window_minutes` ceiling (never exceed it).
- Where fill rate is low with negligible slippage, keep the window unchanged — no
  widening is ever automatic.

### 6. Refusal-reason taxonomy extension
New recorded reasons: `cohort_negative_expectancy`, `cohort_insufficient_evidence`
(when gate is strict), `symbol_loss_circuit`, `adverse_slippage_history`. All appear
in the existing refusal-cost telemetry so "Not sent — refused by P-Trades" stays
explainable per order.

## Out of scope
- Exit-policy changes, trailing stops, partial exits (locked by `single_exit_first_target`).
- New ML predictor models (the readiness-gated proposal system remains the path).
- Live enablement (still requires the separate staged rollout + broker evidence).

## Testing
- Unit: cohort expectancy gating math (CI boundaries, sample floors), circuit-breaker
  transitions, risk-multiplier bounds, new refusal reasons.
- Invariant: negative-evidence cohort never auto-executes; multiplier never raises risk;
  missing evidence never becomes 0 R or 100% win rate.
- Docs-contract tests stay green; no seed/mock data anywhere.

## Rollout
1. Telemetry (read-only) → 2. Circuit breaker (demo) → 3. Cohort gating (demo) →
4. Risk scaling (demo, default conservative) → 5. Window tuning. Each step is
independently shippable and demo-first.
