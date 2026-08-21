# Prompt 3F — Complete the V2 shadow experiment

V2 currently evaluates every fetched observation and records it, but it never actually enrols
anything into the shadow engine, so the experiment produces no forward-tested outcomes. This
change completes the enrolment path, adds the operational switches and health fields, and makes
the observation ledger idempotent. No V1 behaviour changes.

## 1. Database

One migration, additive only:

- `shadow_engine_state.v2_enabled boolean not null default false` — the real kill switch. No V2
  enrolment can happen unless it is explicitly turned on.
- `shadow_engine_state.research_errors integer not null default 0`,
  `research_last_error text`, `research_last_error_at timestamptz` — durable research health,
  replacing reliance on the in-process counter.
- `shadow_executions.strategy_family text` and `shadow_executions.quality_grade text`, both
  nullable with CHECK constraints (`continuation`/`mean_reversion`, and `A+`/`A`/`B`/`C`) and no
  defaults, so existing V1 rows stay untouched and unlabelled.
- `model_observations`: unique identity on `(run_id, instrument, model_version)` for rows where
  `run_id` is present (partial unique index), so a retried scan job cannot double-count.
- `model_versions` row for version 2 gets the exact code manifest hash used by the running V2
  implementation.

## 2. Enrolment

In the scan pipeline, after the V2 evaluation and only when all of these hold:

1. `v2_enabled` is true in `shadow_engine_state`;
2. the V2 decision is `candidate` with a profile in the `continuation` family
   (mean reversion stays observation-only);
3. `claim_v2_structure()` returned true for that structure key.

Then one row is inserted into `shadow_executions` with `model_version = 2`, `status = 'pending'`,
`signal_id = NULL`, and the V2 entry, stop, TP1/TP2/TP3, R values, risk, ATR, direction,
instrument, detected time, structure identity, observation key, and the new
`strategy_family` / `quality_grade` labels. The observation's disposition becomes
`shadow_enrolled`.

Enrolment is wrapped so that any failure records research health and leaves the V1 job result
untouched. Nothing V2 is ever written to `scanned_signals`, alerts, push, email, webhooks or the
MCP live-signal tools — those paths already filter on the active model version and stay unchanged.

## 3. Evaluator errors and idempotency

- If the V2 evaluator throws, the observation is preserved as `decision = 'error'` with a
  truncated reason instead of being dropped.
- Observation persistence becomes an upsert on the unique identity, so a retried job updates the
  existing pair rather than inserting a second one.
- Research failures increment the durable counters on `shadow_engine_state`.

## 4. Tests (all blocking)

Added to the existing suites:

- V1 no-trade + V2 candidate ⇒ exactly one V2 shadow row.
- V1 cooldown duplicate + V2 candidate ⇒ one V2 shadow row when the V2 claim wins.
- Two simultaneous V2 claims for the same structure ⇒ exactly one enrolment (database-level).
- Repeated/retried observation persistence does not increase the observation count.
- `v2_enabled = false` ⇒ zero V2 enrolments; `v2_enabled = true` ⇒ eligible candidate enrols.
- V2 evaluator error produces a durable `error` observation.
- A failing V2 shadow insert does not alter the V1 job result.
- No `model_version = 2` row is reachable from any live signal/feed/alert read path.
- The `model_versions` version-2 hash expected by the migration equals `MODEL_V2_CODE_HASH`.

## 5. Verification

`bun run verify` (lint:blocking → typecheck → blocking tests → build) is re-run and the exact
test counts and results reported.

## Explicitly unchanged

ABC detection, grading, confidence/confluence scoring, entry, stop, targets, replay semantics,
learning formulas and priors, alerting, risk policy, and the shadow resolver's V1 scope.
