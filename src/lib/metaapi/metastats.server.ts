/**
 * MetaStats API reads.
 *
 * MetaStats answers 202 with `retry-after` while it is still crunching an
 * account's history. That is NOT an error and NOT an empty result: callers get
 * `{ status: "processing" }` and must show "still calculating" rather than
 * zeros. Request volume is governed by a durable server-side budget owned by the
 * caller (Stage 5), never by ad-hoc polling from the UI.
 */
import { classifyMetaApiFailure } from "./errors";
import { metaApiRequest } from "./request.server";

export interface MetaStatsMetrics {
  trades?: number | null;
  wonTrades?: number | null;
  lostTrades?: number | null;
  wonTradesPercent?: number | null;
  profit?: number | null;
  balance?: number | null;
  equity?: number | null;
  maxDrawdown?: number | null;
  expectancy?: number | null;
  averageWin?: number | null;
  averageLoss?: number | null;
  [key: string]: unknown;
}

export type MetaStatsResult<T> =
  | { status: "ok"; data: T; observedAt: string }
  | { status: "processing"; retryAfterSeconds: number | null }
  | { status: "unavailable"; reason: string };

async function read<T>(label: string, path: string): Promise<MetaStatsResult<T>> {
  try {
    const data = await metaApiRequest<T>({
      service: "metastats",
      label,
      path,
      throwOn202: true,
    });
    if (data === null) return { status: "unavailable", reason: "MetaStats returned no payload" };
    return { status: "ok", data, observedAt: new Date().toISOString() };
  } catch (err) {
    const failure = classifyMetaApiFailure(err);
    if (failure.kind === "processing") {
      return { status: "processing", retryAfterSeconds: failure.retryAfterSeconds };
    }
    return { status: "unavailable", reason: failure.message };
  }
}

export async function fetchMetrics(
  accountId: string,
  includeOpenPositions = false,
): Promise<MetaStatsResult<MetaStatsMetrics>> {
  return await read<MetaStatsMetrics>(
    "metastats metrics",
    `/users/current/accounts/${accountId}/metrics?includeOpenPositions=${includeOpenPositions}`,
  );
}

export async function fetchOpenTrades(
  accountId: string,
): Promise<MetaStatsResult<Record<string, unknown>[]>> {
  return await read<Record<string, unknown>[]>(
    "metastats open trades",
    `/users/current/accounts/${accountId}/open-trades`,
  );
}
