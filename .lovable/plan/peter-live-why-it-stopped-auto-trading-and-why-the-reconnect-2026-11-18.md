# Peter Live: why it stopped auto-trading and why the reconnect shows Observe

## What the records show (read-only, 18 Nov 09:20 UTC)

- **No code changes to accounts or order sending since 17 Nov 11:05 UTC.** The last live order (11:35 yesterday) was accepted by the broker after those changes, so they did not stop live trading at the time.
- **The automatic checks for your account stopped at 16:31 UTC yesterday.** 26 new setups arrived after that, and none was even considered for Peter Live. That is the sign the account had already been switched to Observe by then. Nobody at P-Trades changed the platform live switches (last change 25 Sep).
- **The cause of that 16:31 switch is not proven yet.** The only code that does it automatically is the safety rule: if the broker reports "trading not allowed", investor (read-only) login, or the account isn't confirmed, P-Trades drops the account to Observe. **That is a gap in my earlier work:** the saved reason is wiped on the next 5-minute check, so it can't be read now. And Observe switches are not recorded as events, so there is no history.
- **At 05:04 UTC today, Peter Live was disconnected** (the Disconnect button). That always sets an account to Observe and removes its broker link.
- **Since then, 6 new connections were created** (LIVE, EE, Ee, EE, Peter-live). The newest one, "Peter-live" (09:10), exists at the connection provider but **your broker has not accepted the login**. It shows Not verified, Permission unknown, and no balance. Automatic orders can only switch on by themselves once the broker confirms the account is real and trading is allowed. So Observe is expected for now. Usually this means the password or server name is wrong (it must be the **master/trading** password, not the investor password).

## Plan

1. **Diagnose the new connection (read-only):** read "Peter-live"'s state from the connection provider (connection status, login error, server). Then tell you exactly what to fix on the secure login page.
2. **Fix the lost reason:** keep the stand-down reason after later checks. Add an append-only history of every mode change: who or what changed it, when, and why (manual Observe, Disconnect, broker said trading not allowed, emergency stop).
3. **Show it on the account card:** for example "Automatic orders stopped 16:31 UTC: your broker reported trading not allowed."
4. **Alert:** email/notify the owner when a live account stops automatically.
5. **Confirm automatic orders come back on once the broker confirms the new account:** check that the one-time Live Auto default still applies to a freshly reconnected live account (it has its own new record, so the default should apply). Add a test for it.
6. **Tidy up:** offer to remove the 5 unfinished duplicate connections. They take up account slots. I'll only do this with your approval.
7. Tests for 2, 3 and 5. No orders sent, and no risk settings changed.

## What you can do now

On the "Peter-live" card, open **Secure login page** and re-enter the MT5 **master password** for server EquityEdge-Trade. Then press **Refresh**. Once your broker accepts it, the account should switch to Live Auto by itself.
