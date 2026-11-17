# Live accounts trade automatically by default, with no confirmation step

## What changes for users
- When someone connects a real broker account and the broker confirms it is a real account with trading allowed, it switches straight to **Live auto**. It starts placing automatic orders on the next setup that passes every check. There is no confirmation box and no separate "arm" step.
- The "I confirm live execution" box in Settings is removed. Live auto orders no longer need a signed confirmation, and changing settings no longer resets anyone to dry run.
- **Easy to turn off:**
  - Each live account card on the Accounts page gets a clear "Automatic trading: On / Off" switch at the top. Off puts the account in Observe.
  - Settings gets a matching "Automatic live trading" switch that turns it off for every account.
  - The Control center shows the current state, with a link to the switch.
- Existing live accounts already set to Live auto (Peter Live) start trading right away with no further action.
- **Users who already chose a mode keep it:** accounts set to Observe or Live confirm stay that way. Only new connections default to Live auto. "Live confirm" (approve each order) stays available for anyone who chooses it.

## Kept as is (these protect the money, not ask permission)
- Every order still needs a stop and goes through risk sizing, the account's risk limits (daily loss, total loss, daily trades, P-Trades profit target), news, duplicate, cohort, market-hours and stale-price checks, and the emergency stop.
- Demo and live accounts stay clearly labelled. Unknown broker outcomes are never resent.
- A newly connected live account with no saved risk policy gets a standard starting policy so it can trade immediately: 0.25% risk per trade, 1% hard cap, 3% daily loss, 5% total loss, 2 trades a day. All of it is editable on the card. Without a policy every order would be blocked, which would bring back the "bothered" step.

## Wording updates
- Guide, onboarding, Accounts tips and the AI assistant will say: live accounts trade automatically once connected, and here is how to turn it off.
- The connect screen says plainly: "This account will place real trades automatically. You can turn this off at any time on its card."

## Technical details
- `src/lib/delivery/revalidate.server.ts`: drop the `liveConfirmationValid` requirement for `live_auto`. Keep `globallyLive` (platform switch) and the emergency stop. Keep the per-order owner confirmation for `live_confirm`.
- `src/lib/execution.functions.ts` and `settings.tsx`: remove the confirm-live checkbox and the confirmation-version pinning. Stop resetting to dry run on config changes for live auto. The new "Automatic live trading" switch maps to a user-level off flag that enqueue respects.
- Account connect and refresh flow: when broker facts report `broker_account_type='real'` and `trade_allowed=true` on first successful connect, and the user never chose a mode, set the mode to `live_auto`, insert the default risk-policy row if none exists, and record an audit entry ("default live auto on connect").
- New-user defaults: `execution_enabled=true`, `execution_dry_run=false`.
- Accounts card: an On/Off switch calling the existing owner-scoped mode change (Off sets Observe, On sets Live auto). Settings: a global off flag checked in `direct-enqueue.server.ts` account selection.
- Tests:
  - A live_auto delivery with no confirmation is no longer rejected `live_authorization_stale`.
  - The platform switch off, the emergency stop, or the user switch off still blocks.
  - A new real, trade-allowed account defaults to live_auto with the default policy.
  - An account the user set to Observe is never auto-armed.
- Update AGENTS.md: live auto needs no signed confirmation; consent is the connect-time notice plus an always-visible off switch.
- Verify: run the Peter Live dry-run, then watch the next eligible setup become a sent live order.
