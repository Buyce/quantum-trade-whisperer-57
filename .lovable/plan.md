# Reconnect "That one" (MT5-747314, EquityEdge-Trade) safely

## What was received
- Account ID 01c30d73-... and the provider record: deployed, connected (partial redundancy).
- No trading key was in the uploads. The JSON is account details only. The screenshot shows the broker login password. We don't need that password, so it won't be stored or used. Change it with Equity Edge, because it has now been shared in chat.

## Steps (no orders placed at any point)
1. **You:** switch "That one" to **Observe** on the Accounts page. While it stays on Live Auto, the app could start trading as soon as the connection reads healthy again.
2. **Me:** open the secure form so you can paste the new MetaApi trading key. It saves the key encrypted. The key never appears in chat.
3. **Me:** run a read-only check with the new key against this account. I'll report only the result (allowed or refused).
4. **Me:** update the app's saved record from the provider: connected, deployed, and whether the broker allows trading.
5. **Me:** run Runtime Validation in dry-run mode and report each of the nine checks.
6. **You:** once everything passes, re-arm the account in the mode you choose.

## Technical notes
- Replace the existing trading-key secret with update_secret. The provisioning key stays as it is.
- The check calls only read endpoints (account information). Deploy, trade and arm calls are never used.
- The connected-account record is refreshed through the existing broker sync path. No manual writes.

## Your new request: live accounts that auto-trade
The app can already auto-trade live accounts. A connected real-money account can be switched to "Live, confirm each order" or "Live auto". The problem is the add-account screen: it still labels the live choice "Live account (observe only)", so it looks like live accounts can never trade. Every new account starts in Observe so nothing trades before the broker confirms it.

Changes:
1. Relabel the live choice to "Live account (automatic trading available)", in both the connect wizard and the link-existing form.
2. After a live account connects and the broker confirms it as a tradable real account, show a "Turn on live auto-trading" step on that account. It offers Live confirm and Live auto, and uses the existing signed confirmation and safety checks.
3. If the broker reports trading not allowed, an investor (read-only) login, or a demo account, the step explains why in plain words instead of failing silently.
4. Update the Guide and the assistant so they no longer call live accounts observe-only.
5. The separate "Pair live MT5" bridge is read-only by design and stays that way. Its label will say so clearly.

Safety checks that stay: the broker must report a REAL tradable account, your signed confirmation of the setup, risk policy present, emergency stop, and news, duplicate and market-hours checks.

Technical: copy changes in the accounts route and DirectMt5BridgeCard. The new step reuses offerableModes/canArm and the existing arm flow. No change to the mode rules in src/lib/accounts/mode.ts. Add a test that a confirmed real, trade-allowed account offers live_auto, and that an investor login does not.
