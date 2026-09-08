# Why "take profit in steps" isn't in your list — and how to switch it on

## What I checked

- The stepped choice and the split presets exist in the app code, and the database
  already has the columns that store them (`auto_exit_shares`,
  `auto_exit_trail_runner`). So nothing is missing from the build.
- The Settings dropdown only lists choices the platform limit allows.
- The platform limit right now is **"hold the whole position to the third target"**.
  A stepped choice is treated as a different kind of order, not a deeper target, so
  it is only offered when the platform limit names it exactly. That is why your list
  stops after the third target.
- There is no owner screen anywhere in the app that can change that platform limit,
  and the database routine that records control changes only accepts one other
  control. So today the limit can't be raised from inside the product at all.

## What to build

### 1. An owner switch for how deep customers may take profit

In Admin, next to the other execution switches, add a single control:

- Take profit at the first target
- Hold to the second target
- Hold to the third target
- Half out at the first target, the rest runs (demo only)
- Take profit in steps (demo only)

Changing it requires a reason, is written to the existing change log with who
changed it, and refuses if the value on screen no longer matches the stored one.
The two stepped choices are labelled demo-only, matching the code that already
refuses them on live accounts.

### 2. Make the limit reachable by the routine that records changes

Extend the control-change routine to accept the exit-depth limit alongside the
existing control, validating the value against the five named choices and rejecting
anything else. Text value rather than true/false, so the update path handles both.

### 3. Say why a choice is absent

When the platform limit hides the stepped choices, Settings states plainly that
stepped profit-taking is not currently enabled by the platform, instead of simply
omitting it with no explanation.

### 4. Nothing else changes

Stepped exits stay demo-only, still act only on prices the broker reports, still
refuse when a position can't be split, and stepped results stay separate from
single-target history.

## Also worth knowing

You were looking at the published site. Recent work is on the preview until you
publish, so publish after this change so the live site shows the same list.

## Technical notes

- Migration: widen `set_execution_control` to accept `max_customer_exit_policy`,
  with a whitelist check against the five policy names and a text-typed update
  branch; keep the optimistic-concurrency and audit-insert behaviour.
- `src/lib/execution.functions.ts`: add a server function to set the ceiling
  (admin-gated, reason required) and return the current value; reuse
  `isExecutionPolicy` for validation.
- `src/components/admin/ExecutionSwitchPanel.tsx`: add the select plus reason
  field, invalidate the existing execution-controls query on success.
- `src/routes/_authenticated/settings.tsx`: add the explanatory line under the
  take-profit select when managed policies are filtered out by the ceiling.
- Tests: ceiling validation, refusal on an unknown value, dropdown filtering with
  each ceiling value, and the settings notice text; plus docs updates in
  `docs/EXECUTION.md` and `docs/OPERATIONS.md`.
