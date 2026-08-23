# Why the demo connection fails with "530 / error code 1016"

## What the error actually is

That message is not a broker rejection and not a subscription problem. `530` with
`error code: 1016` is the network layer in front of your broker-connection
provider saying **the hostname P-Trades called does not exist**. Nothing was
created, nothing was charged.

Verified from the sandbox just now:

```text
mt-provisioning-api-v1.agiliumtrade.ai                  -> host does not resolve   (what we call today)
mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai     -> 401 "no auth-token"     (correct host, alive)
mt-client-api-v1.london.agiliumtrade.ai                 -> 404 JSON                (correct, already used)
metastats-api-v1.agiliumtrade.ai                        -> host does not resolve   (what we call today)
metastats-api-v1.london.agiliumtrade.ai                 -> 404 JSON                (correct host, alive)
risk-management-api-v1.agiliumtrade.ai                  -> host does not resolve   (what we call today)
risk-management-api-v1.london.agiliumtrade.ai           -> 404 JSON                (correct host, alive)
```

So three of the five provider services are pointed at hostnames that do not
exist. Account creation is the first one a customer hits, which is why the wizard
fails at "Create connection & open secure page". The candle/quote reads used by
the scanner go through the client and market-data hosts, which are correct — that
is why scanning works while connecting does not.

## The fix

Correct the host resolver, which is the single place hostnames are produced.

1. **Provisioning** becomes `mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai`
   (the provider's own double-suffix domain for this service). This alone
   unblocks connecting a demo account, the secure login page, deploy, and
   disconnect.
2. **MetaStats** and **Risk Management** become region-scoped, exactly like the
   client and market-data services: `<service>.<region>.agiliumtrade.ai`. Their
   callers already know the account's region, so the region is passed in rather
   than guessed; a missing or malformed region keeps failing closed as it does
   today.
3. The host allow-list is updated to match, so only these real hosts are
   trusted and anything else is still refused.
4. Error copy: a "host does not exist" style failure is currently shown to the
   user as raw provider prose. It becomes a plain sentence saying P-Trades could
   not reach the broker-connection provider and nothing was created, with the
   technical detail kept for the operator.

## After the fix

Retry the wizard: the stuck `MetaQuotes-Demo` row from the screenshot should be
disconnected first (it never got a provider account), then create the connection
again. It should reach the secure login page, then progress to READY, at which
point Demo Auto can be armed.

## Technical notes

- Edit is confined to `src/lib/metaapi/hosts.ts` (`GLOBAL_PREFIX` /
  `REGIONAL_PREFIX`, `resolveHost`, `isTrustedMetaApiHost`), the metastats and
  risk-management server modules that call `metaApiRequest` without a region,
  and the existing host tests under `src/lib/metaapi/__tests__/`.
- No change to scanner math, publication, sizing, grading, or the execution
  policy. No new dependency, no schema change.
- Tests: extend the host-resolver tests to assert the provisioning host, the two
  newly regional hosts, and that the old non-resolving forms are no longer
  trusted.
