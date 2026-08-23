/**
 * Broker symbol specifications (contract size, volume bounds, stops level, ...).
 *
 * Called at most once per symbol per 24h by the spec refresher — never per
 * render and never inside the grading path.
 */
import { readBenchmarkAccount } from "./config.server";
import { metaApiRequest } from "./request.server";
import type { SymbolSpecification } from "./types";

export async function fetchSymbolSpecificationFor(
  accountId: string,
  region: string,
  symbol: string,
): Promise<Record<string, unknown> | null> {
  const raw = await metaApiRequest<Record<string, unknown>>({
    service: "client",
    region,
    label: `${symbol} specification`,
    path:
      `/users/current/accounts/${accountId}` +
      `/symbols/${encodeURIComponent(symbol)}/specification`,
  });
  if (!raw || typeof raw !== "object") return null;
  return raw;
}

/** Specification from the benchmark account (the pricing reference feed). */
export async function fetchSymbolSpecification(
  symbol: string,
): Promise<Record<string, unknown> | null> {
  const { accountId, region } = readBenchmarkAccount();
  return await fetchSymbolSpecificationFor(accountId, region, symbol);
}

/** Typed view of the same payload, for call sites that want named fields. */
export async function fetchTypedSymbolSpecification(
  accountId: string,
  region: string,
  symbol: string,
): Promise<SymbolSpecification | null> {
  return (await fetchSymbolSpecificationFor(accountId, region, symbol)) as SymbolSpecification | null;
}

/** Symbols the broker exposes on this account. */
export async function fetchSymbols(accountId: string, region: string): Promise<string[]> {
  const raw = await metaApiRequest<string[]>({
    service: "client",
    region,
    label: "symbols",
    path: `/users/current/accounts/${accountId}/symbols`,
  });
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : [];
}
