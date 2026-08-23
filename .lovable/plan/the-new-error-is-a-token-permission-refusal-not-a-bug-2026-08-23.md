# The new error is a token-permission refusal, not a bug

## What the error says

```text
MetaApi 403 ForbiddenError
"You do not have access to
 trading-account-management-api:rest:public:account-management:createAccount"
```

Good news first: the previous failure (530 / 1016, dead hostname) is gone. The
request now reaches the provider's real provisioning service and gets a proper
answer. That answer is: **the access token P-Trades is using is not permitted to
create trading accounts.**

The provider issues tokens with a fixed set of allowed methods. The token
currently configured (`METAAPI_TOKEN`) carries market-data / trading-account
read scopes — enough for the scanner's candles and quotes, which is why scanning
has always worked — but it does not include the account-management group that
`createAccount` belongs to. No amount of app-side change can grant a scope the
token does not have.

## The solution (one step, outside the app)

Issue a new provider token that includes the **trading-account-management API**
(`account-management`) methods, alongside the market-data and client/trading
scopes already in use, then give it to me and I'll store it as the
`METAAPI_TOKEN` secret. Nothing else in the app has to change; the wizard will
then get past "Create connection & open secure page".

When you generate it, keep in the same token:

```text
metaapi-api        (client / trading + market data)   - already have
trading-account-management-api                        - MISSING, needed
metastats-api / risk-management-api                    - only if you want the
                                                         optional monitoring
                                                         features later
```

If you'd rather not widen the scanner's token, the alternative is a second,
account-management-only token stored separately; say the word and I'll add a
distinct configuration key for provisioning traffic only.

## What I will change in the app

Only the copy, so this failure is self-explanatory instead of raw provider JSON:

1. A 403 whose body names a `methodId` is classified as a **permission /
   scope** failure rather than a generic auth failure.
2. The wizard error becomes a plain sentence: "The broker-connection provider
   refused this because the configured access token is not allowed to create
   accounts. Nothing was created or charged — the token needs
   account-management permission." Technical detail stays for the operator.
3. The stuck `Mr Demo` / `MetaQuotes-Demo` rows stay disconnectable, since no
   provider account was ever created for them.

## Technical notes

- Classifier: `src/lib/metaapi/errors.ts` — add a `permission` kind for
  401/403 bodies containing `ForbiddenError` or `methodId`, keeping the existing
  billing and feature-not-enabled branches ahead of it.
- Surfacing: the account-wizard error path in
  `src/routes/_authenticated/accounts.tsx` and the shared account guidance copy.
- Tests: extend `src/lib/metaapi/__tests__` failure-classification cases with
  this exact provider body.
- No change to scanner maths, publication, sizing, grading, execution policy,
  schema, or hosts.
