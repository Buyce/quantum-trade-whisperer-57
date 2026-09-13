# Why that account still exits fully at the first target

## Verified answer

No. Every automatic order on that account was sent as a plain single exit at the
first target, and no part-close or stop move has ever been performed. Checked in
the live database:

- The account holder's saved choice is "half out at the first target, rest runs to
  the second", saved 11 Sep 08:21 UTC.
- Every order actually sent carries the rule `single_exit_first_target` — including
  the ones in the screenshots, which exited exactly at their submitted target.
- The table that records part-closes and stop moves is completely empty: 0 rows.

## Three separate causes, all confirmed

1. **A platform ceiling pins everyone to the first target.** The owner-level
   maximum customer exit rule is set to "first target", and each customer's choice
   is clamped down to that ceiling. So the Settings choice can be saved but can
   never take effect while the ceiling stays there.
2. **The demo check never matches.** Order records store the account mode as
   `demo_auto`, but both the pre-send check and the managed-exit pass compare
   against the literal `demo`. So even with the ceiling lifted, the pre-send check
   would downgrade the managed rule, and the managed pass would find zero
   positions to work on — which is exactly why its record table is empty.
3. **Timing.** The only order sent since the choice was saved was submitted before
   it, so nothing was ever eligible anyway.

## Fix

1. Correct the demo test in both places so `demo_auto` counts as a demo account
   (matching the mode actually stored), keeping the live-account block intact.
2. Raise the platform ceiling to allow the managed rule for customers, leaving the
   ceiling as the emergency way to pull everyone back to the first target.
3. Add regression tests that a `demo_auto` delivery keeps its managed rule through
   the pre-send check and is picked up by the managed pass — the gap that let this
   go unnoticed.
4. Show the effective rule honestly: where the choice is currently reduced by the
   ceiling, say so in Settings and in the automatic-order summary instead of
   showing the saved choice as if it were in force.

## Technical notes

- `src/lib/delivery/revalidate.server.ts` line ~423 and
  `src/lib/delivery/manage-positions.server.ts` (`.eq("account_mode","demo")` plus
  the account-row assertion) both need to accept the stored `demo_auto` mode.
- `execution_controls.max_customer_exit_policy` is `single_exit_first_target`;
  `resolveExitPolicy` in `src/lib/delivery/execution.ts` clamps to it.
- No broker positions are touched by this change; managed steps stay demo-only,
  idempotent, and record unconfirmed broker actions as unconfirmed.
