# Prompt 14 — Stage 1: MetaApi Access Layer

Foundation only. No new user-facing behaviour, no schema changes, no execution.
Everything after this stage (account provisioning, demo auto-execution, broker
evidence, MetaStats/Risk telemetry) is built on top of it.

## What this stage delivers

A single, well-guarded place where all MetaApi traffic happens, replacing the
hardcoded benchmark-account constants that currently sit inside the scanner.

- Benchmark account id, region and magic number move out of source code into
  server configuration.
- One request path with the existing 8-second timeout, one error vocabulary, one
  region-to-host resolver so no hostname can ever come from user input.
- Broker account classification (demo / real / contest, read-only, MT5 netting)
  becomes pure, testable logic derived from the broker's own reported fields —
  never from what a user claims their account is.
- The scanner keeps working exactly as it does today; its MetaApi module becomes
  a thin pass-through to the new layer.

## Safety rules baked in at this stage

- Unknown or unreadable broker fields resolve to the restrictive answer, never
  the permissive one.
- MT5 netting accounts are detected and reported as unsupported for Risk
  Guardian (documented vendor limitation), instead of implying protection.
- Live automatic execution is representable but gated OFF; only observation and
  demo automation can ever be eligible after this stage.
- A provider billing refusal is classified as "data unavailable", never as a
  negative trading answer.

## Technical detail

New module set under `src/lib/metaapi/`:

```text
errors.ts        timeout / not-configured / http errors + failure classifier
hosts.ts         region -> trusted host (provisioning, client, market-data,
                 metastats, risk-management); strict region shape, fail closed
types.ts         narrow wire shapes actually read by P-Trades
classify.ts      account type, read-only, MT5 netting, mode eligibility,
                 provisioning lifecycle phase (all pure)
client-id.ts     clientId builder: strategyId_positionId_orderId, <= 31 chars
trade-result.ts  numericCode -> accepted / rejected / unknown
config.server.ts token + benchmark account id/region/magic from env
request.server.ts single fetch wrapper: 8s AbortController, token injection,
                 retry-after capture, no credential logging
market.server.ts candles + current price
specs.server.ts  symbol specification / symbol list
accounts.server.ts account information, positions, orders
provision.server.ts create (idempotency transaction-id), configuration link,
                 read, deploy / undeploy / redeploy, delete
trade.server.ts  pending-order submission (Stage 3 uses it)
margin.server.ts margin estimate endpoint
history.server.ts historical orders / deals by time range (Stage 4)
metastats.server.ts metrics + open trades, 202/Retry-After aware (Stage 5)
risk-management.server.ts trackers + equity chart (Stage 5)
```

Server configuration keys read inside handlers only:
`METAAPI_TOKEN`, `PTRADES_BENCHMARK_METAAPI_ACCOUNT_ID`,
`PTRADES_BENCHMARK_METAAPI_REGION`, `PTRADES_BENCHMARK_MAGIC`.

`src/lib/scanner/metaapi.server.ts` is rewritten as a facade re-exporting
`fetchCandles`, `fetchQuote`, `fetchSymbolSpecification`,
`MetaApiTimeoutError`, `MetaApiNotConfiguredError` with unchanged signatures and
message shapes, so `pipeline.server.ts`, `specs.server.ts`,
`revalidate.server.ts`, `shadow_resolve.server.ts` and `fx.ts` are untouched.

New blocking tests (`src/lib/metaapi/__tests__/`), all taxonomy-tagged:
host resolution and rejection of malformed/untrusted regions; account
classification and unknown-field fail-closed; MT5 netting risk unavailability;
mode eligibility matrix (observe/demo_auto/live off); clientId length and
format; trade-result mapping; failure classification incl. billing and
202/429 retry-after; timeout abort path with a stubbed fetch.

Exit criteria: full suite green (720 existing + new), build OK, scanner
behaviour and heartbeat unchanged.
