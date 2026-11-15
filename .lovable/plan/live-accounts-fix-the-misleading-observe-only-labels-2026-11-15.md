# Live accounts: fix the misleading "observe only" labels

## Current state (checked 13:28 UTC)
"Peter Live" (Equity Edge, ••••7314) is connected and deployed. The broker confirms it as a REAL account with trading allowed, not a read-only login. It's set to Live auto, has a risk policy (50K, 0.25% risk, 1% hard cap, 3% daily and 5% total drawdown), and no emergency stop. The platform-wide live auto switch is on, so it can receive automatic orders on the next eligible setup.

Adding live accounts that auto-trade already works. Only the wording is wrong.

## Changes
1. In the connect wizard and the link-existing form, rename "Live account (observe only)" to "Live account (automatic trading available)".
2. Rename "Pair live MT5 (observe only)" on the Direct MT5 Bridge to "Pair live MT5 (read-only bridge)". The bridge itself stays read-only.
3. Update the Guide and the assistant so they no longer call live accounts observe-only.

## Technical
- Copy-only edits in src/routes/_authenticated/accounts.tsx, DirectMt5BridgeCard.tsx and the guide and assistant knowledge text.
- No change to the mode rules or the arming gates.
