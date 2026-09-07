# Let the auto-trader run further targets

Today every automatic order is sent with the **first target only** (TP1, roughly 1:1).
TP2, TP3 and the 3R reward shown on a signal card are never sent to the broker. You
want the auto-trader to work the deeper targets too.

Before that can be switched on truthfully, one thing has to be fixed: the evidence
that is supposed to tell us whether deeper exits actually pay more is **empty, and
empty because of a fault** — not because we're still waiting for data.

## What the check found

- The exit-variant study in Admin shows every option with **0 samples** and "the
  replayed path record is still too thin".
- The reason: the study reads a second, research-only replay record for each setup
  (the one that captures the full price path after entry). **Zero of those records
  exist.** All 1,837 replay rows are the old first version.
- The database step that creates them fails every single time on a duplicate-key
  error (`shadow_executions_signal_id_key`): that table still enforces one row per
  signal, so the research twin can never be inserted. The engine has logged **94
  research errors**, the latest at 04:46 UTC today.

So the deeper-exit question has never actually been measured once. Fixing that is
step 1, not optional.

## Plan

### Stage 1 — Repair the research path record (unblocks everything)

- Replace the one-row-per-signal rule with one that allows the same signal to have
  one row per replay version and execution policy (the matching unique index
  already exists), so the research twin can be created.
- Reset the recorded research-error counter with a note of what it was.
- Backfill research twins for existing setups that are still inside the window the
  broker's history can reach, oldest-first and bounded, so paths start accumulating
  immediately rather than only for future signals.
- After the next hourly run, confirm in Admin that path records and exit-variant
  samples are climbing.

### Stage 2 — Measure the simple deeper exits too

The study currently compares: first target only, half-out-plus-runner to TP2/TP3,
break-even after 1R, and a 1R trailing stop. It does **not** yet include the
simplest change you asked for: leaving the whole position on to the second or third
target. Two variants get added — **single exit at second target** and **single exit
at third target** — simulated against the same recorded paths, so they are compared
like-for-like with today's policy. Undecidable paths stay undecidable; nothing is
resolved in our favour.

### Stage 3 — Make deeper exits a real, switchable order policy

Two capabilities, deliberately in this order:

**3a. Deeper single exit (no broker babysitting).** The order still goes out once,
with stop and target attached, but the target can be TP2 or TP3 instead of TP1.
Nothing has to be managed after the fill, so this carries no new failure modes.
Implemented as named policies (`single_exit_second_target`, `single_exit_third_target`)
in the order builder, the direct broker submission and the delivery record, plus an
owner setting to choose it and a Guide/Settings explanation of the trade-off
(fewer wins, bigger wins).

**3b. Half out at the first target with a runner.** This needs P-Trades to act on a
position *after* it fills: close part of it, then move the stop to break-even. That
means new broker calls (partial close and stop modification), a management worker
that is safe to re-run, and proof that a half-close either happened or clearly did
not. Built only after 3a is live and 3b has measured support, because a
half-managed position is worse than either clean policy.

### Gating and safety (unchanged rules)

- Deeper-exit policies stay **off by default**. Turning one on is an explicit owner
  choice per account mode.
- Demo-auto first. Live accounts keep every existing gate: global live switches,
  drawdown brakes, cooldowns, the intelligence gate, exposure and spread ceilings.
- Statistics stay labelled by the policy that produced them: a deeper-exit order is
  never scored against first-target history, and the win-rate/expected-R evidence
  panels show which policy each figure describes.
- No fabricated numbers anywhere: if the path record cannot decide an exit, it stays
  undecided.

### What you'll see when it's done

- Admin → Intelligence exit-variant panel filling with real sample counts, and a
  measured comparison of first / second / third target and the runner variants.
- A Settings choice for which target automatic orders should work, off by default,
  with plain wording about the win-rate versus reward trade-off.
- Signal cards stating what an automatic order will actually target, so the reward
  figure on the card and the auto-trader stop disagreeing.

## Technical notes

- Migration: drop `shadow_executions_signal_id_key`; identity is already covered by
  `shadow_executions_plan_replay_policy_key` and the candidate identity index.
  Backfill via the existing sibling logic, bounded per run.
- New research variants in `src/lib/execution/exit-variants.ts` +
  `src/lib/learning/exit-variants.server.ts`; the replay-registry semantics hash is
  provenance for the labeller and stays untouched — variants are simulated on top of
  recorded paths, not a replay rule change.
- Live policy plumbing: `ExecutionPolicy` in `src/lib/delivery/execution.ts`,
  `buildBridgeOrder`, `src/lib/execution/direct.ts` (`finite(plan.tp1, ...)` becomes
  policy-selected), revalidation's submitted-plan record, and the delivery/decision
  logs.
- Stage 3b would add `POSITION_PARTIAL_CLOSE` / `POSITION_MODIFY` support to
  `src/lib/metaapi/trade.server.ts` plus a management pass in the reconcile worker.
- Tests: variant simulation, policy-selected order construction, refusal when a plan
  has no TP3, and documentation-contract updates for `docs/EXECUTION.md` and the Guide.
