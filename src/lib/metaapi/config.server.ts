/**
 * Server-side MetaApi configuration.
 *
 * Read INSIDE handlers only — `process.env` is not populated at module scope in
 * the worker runtime. Nothing here is exported to the client bundle.
 */
import { MetaApiNotConfiguredError } from "./errors";
import { isValidRegion } from "./hosts";

/** Application tag MetaApi attributes our traffic to. */
export const METAAPI_APPLICATION = "MetaApi";

/** Hard abort budget for every outbound MetaApi call. */
export const REQUEST_TIMEOUT_MS = 8_000;

/**
 * The provider access token.
 *
 * Account management (creating and deleting trading accounts) needs a token that
 * is NOT restricted to a single account, while market data and trading work with
 * an account-scoped one. The ordered candidate list lets the request boundary
 * try the other configured token only after an explicit 401/403. It is never a
 * general network/5xx failover and duplicate values are removed.
 */
export function readMetaApiTokens(purpose: "general" | "provisioning" = "general"): string[] {
  const general = process.env["METAAPI_TOKEN"];
  const provisioning = process.env["METAAPI_PROVISIONING_TOKEN"];
  const ordered = purpose === "provisioning" ? [provisioning, general] : [general, provisioning];
  const tokens = ordered.filter(
    (token, index, all): token is string => Boolean(token) && all.indexOf(token) === index,
  );
  if (tokens.length === 0) throw new MetaApiNotConfiguredError("METAAPI_TOKEN");
  return tokens;
}

/** Primary token retained for pre-flight inspection and existing callers. */
export function readMetaApiToken(purpose: "general" | "provisioning" = "general"): string {
  return readMetaApiTokens(purpose)[0]!;
}

export interface BenchmarkAccountConfig {
  accountId: string;
  region: string;
  /** MT magic number stamped on every benchmark order. */
  magic: number;
}

const DEFAULT_BENCHMARK_MAGIC = 140714;

/**
 * Read only the reserved provider account id.
 *
 * Customer-account guards use this narrower reader so they still protect the
 * reserved account when an unrelated benchmark setting (region or magic) is
 * temporarily missing or malformed.
 */
export function readBenchmarkAccountId(): string | null {
  const accountId = process.env["PTRADES_BENCHMARK_METAAPI_ACCOUNT_ID"]?.trim();
  return accountId || null;
}

/**
 * The P-Trades benchmark demo account. Previously hardcoded in the scanner;
 * now configuration, so the account can be rotated without a code change.
 */
export function readBenchmarkAccount(): BenchmarkAccountConfig {
  const accountId = readBenchmarkAccountId();
  if (!accountId) throw new MetaApiNotConfiguredError("PTRADES_BENCHMARK_METAAPI_ACCOUNT_ID");

  const region = process.env["PTRADES_BENCHMARK_METAAPI_REGION"];
  if (!isValidRegion(region)) {
    throw new MetaApiNotConfiguredError("PTRADES_BENCHMARK_METAAPI_REGION");
  }

  const rawMagic = process.env["PTRADES_BENCHMARK_MAGIC"];
  const magic = rawMagic === undefined ? DEFAULT_BENCHMARK_MAGIC : Number(rawMagic);
  if (!Number.isInteger(magic) || magic <= 0) {
    throw new MetaApiNotConfiguredError("PTRADES_BENCHMARK_MAGIC");
  }

  return { accountId, region, magic };
}

/** TRUE when the benchmark account is fully configured (no throw). */
export function hasBenchmarkAccount(): boolean {
  try {
    readBenchmarkAccount();
    return true;
  } catch {
    return false;
  }
}
