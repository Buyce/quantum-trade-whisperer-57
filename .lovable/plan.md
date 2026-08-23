# Fix broker-account provisioning: token scope + adopt-existing path

## What's actually wrong

The 403 is a token-scope refusal, not a broker or billing problem. The token you generated has `trading-account-management-api` with reader+writer, but every access rule is pinned to one resource:

```
resources: ["*:$USER_ID$:f6a72106-7709-4835-8022-75cad470a505"]
```

`createAccount` is not an operation *on an existing account*, so a token restricted to a single account ID can never authorise it. The same 403 will repeat with this token.

Two things are needed: an account-unrestricted token, and a way to link an account that already exists at the provider without calling create at all.

## One important finding about that account ID

`f6a72106-7709-4835-8022-75cad470a505` is the account the scanner/benchmark engine uses (it is what `PTRADES_BENCHMARK_METAAPI_ACCOUNT_ID` points at). Provisioning already refuses to attach it to a customer connection on purpose — mixing the research/benchmark account into a user's journal would corrupt performance statistics and research provenance. So the "adopt an existing account" path will be built, but it will keep refusing this particular ID with a clear explanation. To adopt an account with it, it must be a separate demo account you create at the provider.

## What gets built

### 1. Token replacement (you act first)

In the provider console, open **API Access** in the left sidebar (not the per-account "Generate token" page). Enable:

- Trading account management API — Read-write access to resources, **no** resource restriction (leave Entity/Id empty)
- MetaApi REST API, MetaApi RPC over websocket API, real-time streaming API
- MetaStats API, Risk management API

Then I request it through the secure secret form and store it as `METAAPI_TOKEN`. Revoke the token you pasted into chat — it is exposed now.

### 2. Detect resource-restricted tokens and say so plainly

Extend the provider error classification so a 403 naming `createAccount` (or any `methodId`) is reported as: the configured access token is restricted to specific accounts and cannot provision new ones; nothing was created or charged. Add a pre-flight check that decodes the configured token's `accessRules` payload (claims only — no signature trust) and, before the create call, refuses early with the same message when no unrestricted `trading-account-management-api` write rule is present. This turns a confusing provider 403 into an actionable configuration message in the wizard.

### 3. "Link an account I already have" path

Add a second entry point in the accounts wizard alongside "Create a demo connection":

- The owner supplies the provider account ID and picks intent (demo/live) and label.
- The server verifies the account exists, reads its platform, server, region and login from the provider, and refuses if it is the benchmark/scanner account, is already linked, or breaches the demo/live quota.
- On success the row is inserted straight into the existing lifecycle at the post-credentials stage and reconciled through the normal DEPLOYED → CONNECTED → verified → READY path, so nothing downstream changes.
- Everything after linking (Observe mode default, arming, sizing gates, evidence, telemetry) is unchanged.

This path only needs read access plus per-account rights, so it works even with a restricted token.

## Technical notes

- Files touched: `src/lib/metaapi/errors.ts` (new restricted-token classification), a small token-claims reader under `src/lib/metaapi/`, `src/lib/accounts/provision.server.ts` (`adoptConnection`), the accounts server functions and `src/routes/_authenticated/accounts.tsx` for the second wizard entry.
- No schema change: adoption reuses `connected_trading_accounts`, its quota trigger and phase machine.
- The benchmark guard (`assertNotBenchmark`) is applied to adoption before any write.
- Tests: classification of the resource-restricted 403, the token pre-flight refusal, and adoption cases (benchmark ID refused, duplicate refused, quota refused, happy path lands in the right phase).

## Sequence

1. You generate the unrestricted token and revoke the pasted one.
2. I request it via the secure form and store it.
3. I ship the error detection, pre-flight and adoption path, then run the suite and build.
