/**
 * Scanner-facing MetaApi facade.
 *
 * The implementation now lives in `src/lib/metaapi/` (one request path, one
 * error vocabulary, one trusted-host resolver). This module stays as the
 * scanner's stable import surface so `pipeline.server.ts`, `specs.server.ts`,
 * `revalidate.server.ts`, `shadow_resolve.server.ts`, `fx.ts`, the sizing
 * service and the public quotes route keep their existing call shapes.
 *
 * The benchmark account is no longer hardcoded here; it comes from server
 * configuration via `readBenchmarkAccount()`.
 */
export { REQUEST_TIMEOUT_MS as FETCH_TIMEOUT_MS } from "@/lib/metaapi/config.server";
export { MetaApiNotConfiguredError, MetaApiTimeoutError } from "@/lib/metaapi/errors";
export { fetchCandles, fetchQuote, type BrokerQuote } from "@/lib/metaapi/market.server";
export { fetchSymbolSpecification } from "@/lib/metaapi/specs.server";
