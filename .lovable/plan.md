# P-Trades: closure proof, personal MT5 history, learning re-audit

Starting point is local HEAD 00e9dba0. That matches the revision Codex named. Two of the four Codex gaps can be seen directly in `src/lib/evidence/associate.ts`. Line 106 marks a position as foreign when its clientId is missing from `groups`. Line 110 skips any deal whose clientId already has a group ("already absorbed"). The supplied Learning Audit, Closure Incident, Closure Review .mjs, evidence JSON and runtime SQL are **not in the uploads folder**. Each of their findings will be checked against source and the backend. None is assumed true.

Every phase reports two separate states: **code/build ready** and **observed in the deployed app**.

## Phase 0: Deployment and access evidence (read-only)
- Find the revision serving preview and published, which backend both use (one shared instance), and which worker origin the scheduler calls (read the pg_cron jobs and their URLs).
- If I can't reach the deployed revision, the report says so. No assumptions.
- Check the saved provider mapping for account 1abc8f49 against 01c30d73, plus its region.

## Phase 1: Prove and finish the ticket 49064728 closure
1. Read the raw saved evidence (row e90cd4f7, delivery 79618) to get the real positionId. It may differ from the ticket.
2. Read-only MetaApi calls on the correct account and region:
   - deals by that position
   - deals by time range covering the trade
   - current open positions
3. Save a redacted diagnostic of each deal (id, orderId, positionId, entryType, symbol, clientId, magic, reason, volume, price, time/brokerTime, profit, commission, swap, fee) and why it was accepted or rejected.
4. Give each possible cause a verdict: deployment mismatch, wrong account/region, provider sync, time window/time zone, pagination, association rejection, write failure, stale response, stale browser.
5. Fix the matcher with tests that fail on the current code first:
   - Track the IDs of matched deals, not group membership. This fixes gaps 1 and 4.
   - Treat an INOUT reversal as a mixed position and refuse it (gap 2).
   - Require the closing symbol to match exactly. A missing symbol means refuse (gap 3).
   - Extra tests: multiple owners, one clientId across positions, duplicate IDs, unordered history, OUT_BY, partial and multiple closes, no entry evidence.
6. Confirm reconciliation and `recover.server.ts` both import the same matcher.
7. Add a bounded read-deals-by-position recovery for saved open evidence that is missing from current broker positions:
   - per-pass budget, rate limit, explicit error, full pagination
   - never infer a close from absence
   - first show that the existing window actually misses this case
8. Writes and contract:
   - Keep closed evidence immutable, and keep initial-stop provenance, currency and all costs.
   - Exit volume must equal entry volume before a trade counts as closed. Otherwise it shows "closure awaiting broker evidence" or "mismatch", and capacity protections stay in place.
   - The reconciliation route returns non-2xx (or an explicit degraded status) when any account had read or write errors.
   - Per-account health must not show success over those errors.
9. Check that History, Performance, MCP list_broker_trades / get_performance_summary / get_automatic_orders and the risk brakes read the saved result.

**Acceptance:** the broker's closing legs are saved, exit volume is 0.09, and exit, costs and net match the broker. The evidence and delivery are settled, and every view agrees. This can only be observed after you publish. Until then it is reported as unverified. The screenshot is never used as data.

**Rollback:** revert the matcher module; closed rows already saved stay immutable.

## Phase 2: Personal MT5 history (opt-in, separate)
- New tables, all owner-scoped with RLS and grants, plus an audit log:
  - `broker_history_imports` (checkpoints, covered interval, truncation state)
  - `broker_history_deals` (raw provenance; unique on provider + account + deal ID)
  - `broker_history_positions` (normalized, with a transform version)
- Read-only backfill in time chunks with paging, bounded retries and incremental sync.
- Rebuild positions with hedging/netting rules (IN/OUT/INOUT/OUT_BY, partials, costs, currency). Balance, credit and financing records are excluded from trading results.
- Origin labels:
  - P-Trades auto
  - P-Trades with a manual intervention
  - verified personal manual
  - external EA / unknown
  - Magic 0 alone is never enough to call a trade manual, and no setup is linked by nearest price or time.
- R is calculated only when the initial stop is known. Otherwise R is left unavailable.
- Start with one small interval and reconcile its counts and money against MT5 history, then expand. "All history" is claimed only for a verified covered interval.
- New Accounts → "Account history" view, separate from P-Trades strategy performance. The assistant gets labelled read access.
- Never pooled across users. No training or live-policy changes come from it.

## Phase 3: Learning-chain re-audit (verdict matrix)
For each of the 12 listed items, give a verdict: confirmed, partly true, fixed, refuted or not verifiable. Each comes with the source line, the deployed schema or flag (queried), redacted runtime evidence, impact, and a regression test where it gets fixed. Fixes are made in this order:
1. **Q-Core dataset:** fix the origin/join identity, not the safety constraint.
2. **Advancement:** null net_r stays null, with a fallback to realized_r, tested for null, unavailable, positive and negative.
3. **One evidence identity:** model, replay, policy, manifest, feature and cost versions plus an input cutoff, used by cohort, direct-enqueue and intel-gate. Stop picking the largest sample.
4. **Benchmark SQL:** label self-reported trades honestly and keep them separate from broker-verified trades.
5. **Walk-forward, exit-variant and Q-Core reads:** full paging or explicit windows, and refuse to run when the data is truncated.
6. **Q-Core backtest:** reproduce neutral-vs-selected; add abstention, coverage, a paired baseline and uncertainty; rename what it actually measures.
7. **Payoff recompute:** check the hosted schedule and how old the last run is; keep replay vs TP1 policy and missing costs explicit.
8. **Execution-quality stats:** separate pre-send refusals, dry runs, broker rejections and unknown outcomes.
9. **Learning-job monitor:** an Admin panel showing state, last attempt and success, cutoffs, samples and errors per subsystem.
10. **Production callers:** verify digital twin, flight recorder, prop-risk and kernel actually have callers, and correct any claims they don't support.
11. **Runtime state:** owner flags, enrolment, proposals, rollbacks, and V2/V3/Q-Core progress, all queried.
12. **"Self-learning":** an honest definition with code evidence. No marketing claims.

Deliver an updated map: candles → scanner → observation → replay → stats → proposal → validation → apply/rollback, and broker → reconciliation → quality/risk. Each link shows producer, consumer, table, identity, schedule, flag, freshness and failure behavior.

## Phase 4: Research and critique
- Use official MetaApi and MQL5 pages, plus public repositories I can actually reach, with citations and their limits.
- Offer alternatives with benefit, evidence needed, complexity and failure modes, including:
  - purged chronological validation with day/position clustering
  - a registered forward holdout
  - controls for multiple comparisons and selection bias in manual trades

## Phase 5: Verification
- Run typecheck, the relevant vitest suites, the DB harness and migration/RLS checks, the linter and a build.
- Report skipped or failing setup suites separately, along with the known Windows and legacy-replay limits.
- Provide changed files, migrations and remaining blockers.
- Commits are handled by the platform. I can't create or name Git commits myself.

## Blockers and owner-only items
- **Publishing:** you have to publish before any deployed recovery can be observed.
- **Missing audit files:** please re-upload them if you want a line-by-line comparison.
- **Provider access:** if MetaApi refuses a history read, I'll name the exact cause and page.
