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
 * an account-scoped one. When a dedicated provisioning token is configured it is
 * used for account management only; everything else keeps the general token, so
 * a narrow token stays narrow on the trading path.
 */
export function readMetaApiToken(purpose: "general" | "provisioning" = "general"): string {
  if (purpose === "provisioning") {
    const provisioning = process.env["METAAPI_PROVISIONING_TOKEN"];
    if (provisioning) return provisioning;
  }
  const token = process.env["METAAPI_TOKEN"];
  if (!token) throw new MetaApiNotConfiguredError("METAAPI_TOKEN");
  return token;
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
