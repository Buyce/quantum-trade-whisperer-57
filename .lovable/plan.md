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
