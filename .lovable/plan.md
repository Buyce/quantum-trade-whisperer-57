# Repair plan: "That one" (Equity Edge) deployment refused

## Confirmed so far (read-only, this turn)
- Both secrets exist: `METAAPI_PROVISIONING_TOKEN` and `METAAPI_TOKEN` (values never read or shown).
- Deploy calls `POST /users/current/accounts/:id/deploy` through the provisioning service; the app tries `METAAPI_PROVISIONING_TOKEN` first, then `METAAPI_TOKEN` only after an explicit 401/403. Same order for undeploy/redeploy.
- Market data and trading use `METAAPI_TOKEN` first.
- Not yet confirmed: whether the published site runs this same code, and the account's current state (the earlier observations need a refresh).

## Step 1 — Read-only diagnostics (no deploy, no orders, no setting changes)
1. Refresh the account row: saved mode, connection state, trade_allowed, linked MetaApi account id (shown masked), last deploy error and timestamp.
2. With each token separately, call read-only `GET /users/current/accounts/:id`. Record only: operation, HTTP status, class (auth failure / missing permission / account not found / OK), timestamp.
3. If the read works, report the provider's own state (deployed/undeployed, connection status, broker login state) and separate the five cases you listed: API auth failure, missing method/resource permission, wrong or missing MetaApi account, broker login failure, broker trading disabled / investor password.
4. A successful read is not treated as proof of deploy permission.

## Step 2 — Check the official docs
Confirm from the MetaApi auth and deployAccount pages (and Swagger) the exact permissions our account-management flow needs: read account, deploy, undeploy, redeploy, create/update account, configuration link. Nothing broader.

## Step 3 — Repair
- If the code picks the wrong token or builds the wrong request: smallest fix plus a test, no extra fallback or retries.
- If a new token is needed, I will explain: which MetaApi login to use (the one that owns this account), which permissions to tick and why, and that the secret to replace is `METAAPI_PROVISIONING_TOKEN`. I then open the secure secret form. You never paste tokens or MT5 passwords into chat.

## Step 4 — Safety checkpoint before any deploy
Before replacing the secret or deploying, I ask you to confirm "That one" is disarmed (moved off Live Auto), because reconnecting would make Live Auto effective immediately. Deploy and Live Auto stay pending until you review the next step.

## Step 5 — Non-trading verification
Re-run the read-only check with the new token; after you approve deploy and the account is disarmed, run Runtime Validation (dry run only). A working token does not prove broker trading permission or full readiness.

## Limits
I can't open your MetaApi dashboard or see a token's permission list; I can only see what the API returns.
