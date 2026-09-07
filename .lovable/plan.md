# Deeper targets: customer switch, verified outcomes, managed exits

Three pieces, in the order that keeps every number honest.

## Where the switch is today (short answer)

There is no switch. Which target an automatic order aims at is a single
platform-wide value that only the owner can change from the backend; Admin only
displays it, and it is set to the first target. That is why you could not find it
in Settings. Part 1 below creates the customer control you expected.

## Part 1 — A per-account target choice in Settings

- New choice in Settings, inside the existing "Automatic order rules" section:
  **which target should automatic orders aim at** — first (default), second, or
  third. It applies to that customer's own automatic orders only.
- Plain wording about the trade-off: a deeper target wins less often but wins
  bigger, and a setup that never published that target is skipped rather than
  quietly exited nearer.
- The owner's platform value becomes a **ceiling**: a customer can never choose a
  target deeper than the platform currently allows, and the platform switch stays
  the emergency way to pull everyone back to the first target.
- Signal cards and the automatic-order summary state the target that will
  actually be used, so the reward figure and the auto-trader stop disagreeing.
- Guide and the docs get the same explanation.

## Part 2 — Broker-verified outcomes per target

Today a completed automatic trade is stored without any record of which target it
was aiming at, so Intelligence cannot say whether deeper targets paid off in real
money. Fix the provenance, then report on it.

- Each broker-evidence row records the target rule it was submitted under and the
  published first/second/third target prices at submission, copied from the order
  record — never reconstructed later.
- Rows created before this change keep an explicit "not recorded" marker; they are
  never assumed to be first-target.
- Admin → Intelligence gains a **by-target** breakdown of the broker-verified
  wins, losses and money already shown in Platform totals, plus reached-target
  counts. Buckets with no recorded target rule are shown as unattributed, not
  folded into the others.
- The replay study (first / second / third target) stays as it is; this adds the
  real-money counterpart next to it.

## Part 3 — Managed exits: half out, then stop to break-even

**Demo accounts only** until the broker itself confirms both actions happened.

- Two new broker actions: close part of an open position, and change an open
  position's stop.
- A position-management pass runs alongside the existing reconcile job: when a
  managed order's position reaches the first target, close the configured share,
  then move the stop on the remainder to break-even, then let the remainder run to
  the deeper target.
- Every step is safe to re-run and recorded as done / refused / unknown. A partial
  close that the broker does not confirm is left unknown and never retried blind;
  the position keeps its original protective stop, which is the safe state.
- Evidence stores the part-close and the stop move as separate broker facts, so a
  managed trade's result is split into "first part" and "runner" instead of being
  averaged into an invented single figure.
- Settings exposes it as a fourth option ("half out at the first target, rest
  runs") available on demo accounts, off by default, greyed out with a reason on
  live accounts.
- Statistics stay labelled by the rule that produced them: managed trades are
  never mixed into single-exit history.

## Technical notes

- Settings: new `scanner_settings` column for the per-user exit rule, validated in
  `src/lib/mcp/settings-validation.ts`; enqueue and `revalidate.server.ts` resolve
  effective policy as `min(user choice, platform ceiling)` and keep refusing with
  `policy_target_missing` when the plan lacks that target.
- Evidence: add `execution_policy`, `target_rank`, `published_tp1/2/3` to
  `broker_trade_evidence`, populated in `reconcile.server.ts` from
  `execution_deliveries` (which already carries `execution_policy`); phase-lock and
  immutability triggers extended to the new columns.
- Intelligence: extend `src/lib/admin/trade-totals.ts` with a policy dimension and
  render it in `TradeTotalsPanel`; keep mixed-currency refusal semantics.
- Managed exits: `POSITION_PARTIAL_CLOSE` and `POSITION_MODIFY` in
  `src/lib/metaapi/trade.server.ts`, a new management pass invoked from
  `reconcile-active.server.ts`, with a durable per-position management state row
  (attempted / confirmed / unknown) for idempotency.
- Tests: effective-policy resolution and ceiling clamping, evidence provenance
  backfill semantics, by-target aggregation, management idempotency and
  refuse-on-unknown, plus documentation-contract updates for `docs/EXECUTION.md`,
  `docs/BROKER-EVIDENCE.md` and the Guide.
- Live execution and live auto-trading stay as they are; nothing here turns them
  on.
