# Why the reconnected Peter-live can't talk to the broker

## What the connection service shows right now (read-only, 09:30 UTC)

Your MT5 login 747314 on EquityEdge-Trade now has **two** connections at the connection service:

```text
01c30d73  "Peter Ewalliefoh"  login 747314  EquityEdge-Trade  CONNECTED     (made outside P-Trades, earlier)
bf4121e2  "Peter-live"        login 747314  EquityEdge-Trade  DISCONNECTED  (made today 09:10 via P-Trades)
```

- The connection that traded yesterday (aa771797) **no longer exists**. Pressing Disconnect at 05:04 deleted it at the connection service. That is what Disconnect does, so "reconnect" built a brand-new connection, not the old one.
- The broker and server are fine. The other connection with the same login is connected right now.
- So the only difference in the new one is **what was typed into the secure login page**. The login and server are correct, so the password is the likely problem: a typo, the investor (read-only) password, or a password changed since the old connection was made. You were advised to change it after it appeared in a screenshot. An old connection keeps working with a password saved earlier, but a new one needs the current one.
- Some brokers also refuse a new login when too many sessions are open for the same account. I can't see broker limits from here, so this is unconfirmed.

## Plan

1. **You (2 minutes):** on the Peter-live card, open **Secure login page**. Enter the **current MT5 master password**, not the investor password, then press **Refresh**. If it connects, Live Auto switches on by itself once your broker confirms trading is allowed. Nothing else is needed.
2. **If it still won't connect:** I'll show the exact broker error on the card. Right now the card says only "not yet talking to your broker", which isn't specific enough. I'll read the connection service's detailed status and show it in plain words: wrong password, server not found, or too many sessions.
3. **Make Disconnect clearer:** the confirmation will say "this deletes the broker connection. Reconnecting needs your MT5 master password again". That way nobody loses a working connection by accident.
4. **Optional, only if you ask:** remove the outside connection "Peter Ewalliefoh" (01c30d73), in case your broker limits sessions. I won't touch it otherwise.

No orders are sent and no risk settings change.
