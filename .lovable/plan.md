# Turn on live trading (automatic and confirm-each-trade) for customers

You asked to skip the owner dry run. This plan turns every live switch on now. Real-money orders become possible as soon as a customer arms a real account.

## Risk you are accepting
- No real-money order has ever been sent through P-Trades. The first live order will be a customer's.
- The 8 unknown-outcome demo orders were explained today, but the live path has not been checked end to end against a real broker account.
- Grades show no proven edge yet (under a month of demo only).

## What gets switched on
1. System-wide: live execution ON, live confirm-each-trade ON, live automatic ON.
2. Customer-facing: customer live confirm ON, customer live automatic ON. This lets customers pick "Live, confirm each order" or "Live auto-execution" on the Accounts page.
3. Every change is recorded in the switch history with you as the approver and the reason "owner enabled live without dry run".

## What stays in force (not removed)
- A customer must connect a real account that the broker confirms as REAL, tradable, and not read-only, and arm it themselves. Nothing is armed for them.
- Live auto still needs the owner's signed confirmation of their current settings.
- Every order is rechecked just before sending: the customer's own limits (risk per trade, total exposure, spread, slippage, daily count), news blackout, blocked/reduced instruments and directions, duplicate prevention, and market hours.
- Emergency stop per account and system-wide remain available and immediate.
- Orders with an unknown broker state are never resent.
- Live and demo stay labelled separately everywhere; margin is shown as an estimate.

## Checks after switching
- Accounts page offers the live modes on a real account and still refuses them on a demo one.
- History shows the live confirmation queue.
- The assistant describes live accounts correctly.
- Existing live-path tests updated to match the gates being on; full test suite and build pass.

## Recommended (not blocking)
Keep your own real account at the broker's minimum lot and watch the first few customer live orders on the Admin panel. The emergency stop is one click if anything looks wrong.

## Technical notes
- Updates go through `set_execution_control` (audited, expected-old-value check) for `live_execution_enabled`, `live_confirm_enabled`, `live_auto_enabled`, `customer_live_confirm_enabled`, `customer_live_auto_enabled`; `live_kill_switch_reason` cleared.
- `execution_config_version` bumps automatically so in-flight deliveries revalidate.
- Tests asserting "live refused while gates off" stay, driven by explicit off-state fixtures; add a gates-on case.
- Publish is needed for the live site.
