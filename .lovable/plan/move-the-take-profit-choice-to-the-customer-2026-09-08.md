# Move the take-profit choice to the customer

Today the customer's take-profit list is filtered by a platform-wide limit, and that limit is only changeable from Admin. You want the customer to decide, with everything about that decision living in one place in Settings.

## What changes for you

- Admin loses the "How deep customers may take profit" control entirely.
- In Settings, section **"2. Where an approved order takes profit"** lists all five choices for every account:
  - take profit at the first target
  - hold the whole position to the second target
  - hold the whole position to the third target
  - close half at the first target, stop to break-even, rest to the second target (demo only)
  - take profit in steps to the third target (demo only)
- The two stepped choices keep their split-preset and trailing controls in that same section, so the whole decision is one panel — nothing about it lives anywhere else.
- The "not enabled by the platform" notice and the "platform allows no deeper than…" warning disappear, because there is no platform limit to explain.

## Safety that stays

- Stepped (managed) exits still run on **demo accounts only**. If a real-money account selects one, the order is refused at send time rather than executed unmanaged — this check is server-side and unchanged.
- Every other gate (dry run, live arming, per-delivery revalidation, target must exist on the setup) is untouched.
- Choosing a deeper target still shows the warning that deeper targets win less often; published statistics still describe the first target.

## Technical notes

- `src/components/admin/ExecutionSwitchPanel.tsx`: remove the ceiling select, reason input, Apply button, related state and policy imports.
- `src/lib/admin.functions.ts`: drop `maxCustomerExitPolicy` from the admin read model and the `set_execution_control` ceiling branch (and its validator fields `maxCustomerExitPolicy` / `reason`).
- `src/routes/_authenticated/settings.tsx`: stop filtering `EXECUTION_POLICIES` through `resolveExitPolicy`; render all policies. Remove `exitPolicyCeiling`, `exitPolicyClamped` and the two ceiling notices. Keep the deeper-target toast and the managed-policy share/trailing block.
- `src/lib/delivery/revalidate.server.ts`: keep the demo-only managed check as the authoritative gate; treat the ceiling as the deepest policy so a customer choice is no longer clamped (stop reading `max_customer_exit_policy`, or resolve against `ladder_tp1_tp2_runner_tp3`).
- Leave the `max_customer_exit_policy` column and the widened RPC in place, unused — no destructive migration.
- Tests: update `src/lib/delivery/__tests__/exit-ceiling-options.test.ts` to assert all five policies are offered and that a managed policy on a non-demo account is refused. Update `docs/EXECUTION.md`.
- Verify with the full test run, typecheck and build; publish afterwards so the live site matches.
