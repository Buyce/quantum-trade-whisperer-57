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

export function readMetaApiToken(): string {
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
 * The P-Trades benchmark demo account. Previously hardcoded in the scanner;
 * now configuration, so the account can be rotated without a code change.
 */
export function readBenchmarkAccount(): BenchmarkAccountConfig {
  const accountId = process.env["PTRADES_BENCHMARK_METAAPI_ACCOUNT_ID"];
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
