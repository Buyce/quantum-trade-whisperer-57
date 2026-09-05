# Status of all eight proposals, and the four real problems the audit found

## Direct answer

All eight are now **built**. Two of them are **not actually running**, and one
background job has been **failing every hour for days**. Verified against the
code and the live database today.

| # | Proposal | Built | Actually running |
|---|----------|-------|------------------|
| 5 | Signal edge separated from execution edge | Yes | Yes |
| 1 | Drawdown brakes | Yes | **No — switched off for every account** |
| 2 | Execution-quality scoring | Yes | Yes (33 scored slices) |
| 8 | Automatic cooldowns | Yes | Yes, 0 triggered (nothing has breached) |
| 4 | Adaptive spread norms | Yes | Yes (342 measured slices) |
| 3 | Evidence-ranked slot spending | Yes | Yes (ranks only measured cohorts) |
| 7 | Walk-forward validation | Yes | Runs, but records nothing — no matured research data |
| 6 | Smarter exits in replay | Yes | **No — the research replay it depends on is switched off** |

## The four problems

### 1. The hourly learning rebuild is erroring, every run
The engine's own health row says: `filter lift recompute failed: DELETE requires
a WHERE clause`, with 52 recorded research errors and the latest at 11:09 today.
This is a genuine fault in the database function, not a data shortage. While it
fails, the filter-evidence table is never refreshed, so nothing downstream of it
can learn. Everything else in that hourly job is separately guarded and keeps
working, which is why it has gone unnoticed.

### 2. 628 research setups have been enrolled and not one has ever produced an outcome
450 of them are inside the replay window and dated 27 Aug to 4 Sep, budget is 150
per hour, and the resolved count is zero. That is why walk-forward validation
records nothing. The cause is not yet confirmed — the plan's first step is to
find it before changing anything.

### 3. Smarter-exit research cannot collect data
The post-entry price path is only captured on the Replay V2 research pass, and
V2 shadow replay is switched off in the engine state. Result: zero paths, zero
exit-variant rows. The feature is correct and inert.

### 4. Drawdown brakes protect nobody today
The brakes are wired into both the enqueue and the pre-send check, but no account
has them enabled and the risk-state table is empty. Two accounts are on automatic
with no daily-loss, weekly-loss, consecutive-loss or drawdown ceiling in force.

### Also worth your attention: the live door is open
The control row reads `live_execution_enabled = true`, `live_auto_enabled = true`,
`force_dry_run = false`. Nothing live is happening only because no real broker
account exists — the per-account gate is the last thing holding. That is one
switch of protection, not several.

## Conflicts of logic or control

No contradictions found in the gate stack itself. Every new gate is reduce-only,
each is asked twice (at queueing and immediately before sending), scanner code
still cannot import execution or risk code, and ranking changes order only, never
eligibility. Research cohorts stay out of the production statistics. The problems
above are gaps and one bug — not competing strategies.

## Plan

### Step 1 — Fix the hourly rebuild
Repair the `DELETE requires a WHERE clause` fault in `recompute_filter_lift` so
the filter-evidence rebuild completes, then confirm a clean run and clear the
error state. No change to how evidence is judged.

### Step 2 — Find out why research setups never resolve
Trace one enrolled candidate end to end through the hourly resolver: is it being
claimed, are candles being fetched for it, is it being written back. Report the
cause, then fix exactly that. No fabricated outcomes, no back-dating.

### Step 3 — Turn on the research replay that smarter-exit study needs
Enable Replay V2 shadow replay so new production setups get a V2 research sibling
and a recorded post-entry path. Research-only: live exits stay at first target.
Already-resolved history cannot be back-filled with paths and will not be faked.

### Step 4 — Put the brakes into force
Enable drawdown brakes on your own accounts with the safe defaults already built
(3% daily, 6% weekly, 4 consecutive losses, 10% peak drawdown), confirm the risk
state populates from closed broker trades and broker equity, and surface the
current state in Settings so you can see it is armed.

### Step 5 — Close the live door until it is deliberately opened
Set the global live switches back to off so live execution requires an explicit,
audited flip again, with the reason recorded. Demo automatic trading is untouched.

## Rules kept

No fabricated, seeded or fallback trading data. Unmeasured stays unmeasured.
All gates reduce-only. Broker-held orders never silently cancelled. Live exit
policy stays single-exit-at-first-target.

## Technical notes

- `recompute_filter_lift` needs a bounded `DELETE ... WHERE` (or truncate-by-scope)
  in a new migration; assert a clean run afterwards.
- Step 2 investigates `loadCandidateRows` / `resolveCandidateRow` in
  `src/lib/execution/shadow_resolve.server.ts` against `research_window_status`,
  the candidate budget, and instrument candle availability.
- Step 3 flips `shadow_engine_state.replay_v2_shadow_enabled`; sibling creation is
  already handled by the `create_replay_v2_sibling` trigger.
- Step 4 writes `scanner_settings` brake fields for the owner accounts only;
  `account_risk_state` fills from `broker_trade_evidence` plus `broker_equity`.
- Step 5 uses `set_execution_control` so the change is audited in
  `execution_control_changes`.
