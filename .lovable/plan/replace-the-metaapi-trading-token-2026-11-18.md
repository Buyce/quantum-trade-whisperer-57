# Replace the MetaApi trading token

The token you pasted is a full-access token: account management, trading API, streaming and risk tools. It's the right kind for P-Trades.

**Safety note:** it is now in the chat history. I won't copy or reuse it from here. Once the steps below work, it's best to revoke it in MetaApi and create a new one, then paste that new one only into the secure form.

## Steps

1. **Secure form:** I open the secure form for the saved MetaApi token. You paste the token there, and it replaces the old one. The value never passes through me.
2. **Read-only check:** I confirm the new token can read:
   - your connections: "Peter-live" (new), "Peter Ewalliefoh" and the demo accounts;
   - the account information and positions for Peter-live, once your broker accepts its password.
   No orders, no mode or risk changes.
3. **Report back:** I tell you whether Peter-live is now talking to your broker. If not, the remaining cause is the MT5 master password on its Secure login page, not the token.

## Notes
- The token alone won't fix "not yet talking to your broker". That state is between the connection service and your broker, and depends on the MT5 password entered for that connection.
- The new token only takes effect on your published app after you publish.
