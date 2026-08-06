/**
 * MetaApi REST access (RpcMetaApiConnection semantics only).
 *
 * Deliberately implemented over plain REST/HTTPS instead of a streaming
 * connection: StreamingMetaApiConnection keeps terminal state in memory and
 * silently desynchronises inside short-lived serverless invocations.
 *
 * Every outbound call is wrapped in an 8s abort timeout so the known MT5
 * missing-data infinite loop cannot hang the worker.
 */
import type { Candle, Timeframe } from "./types";

export const METAAPI_ACCOUNT = {
  accountId: "f6a72106-7709-4835-8022-75cad470a505",
  login: "5053558014",
  server: "MetaQuotes-Demo",
  region: "london",
  type: "cloud-g2",
  reliability: "high",
  application: "MetaApi",
  userId: "067203c067c11bc7d5a60157395637f2",
  quoteStreamingIntervalInSeconds: 2.5,
} as const;

const TF_MAP: Record<Timeframe, string> = { H4: "4h", H1: "1h", M15: "15m" };

export const FETCH_TIMEOUT_MS = 8_000;

export class MetaApiTimeoutError extends Error {
  constructor(symbol: string, timeframe: string) {
    super(`MetaApi request for ${symbol} ${timeframe} exceeded ${FETCH_TIMEOUT_MS}ms and was aborted`);
    this.name = "MetaApiTimeoutError";
  }
}

export class MetaApiNotConfiguredError extends Error {
  constructor() {
    super("METAAPI_TOKEN is not configured");
    this.name = "MetaApiNotConfiguredError";
  }
}

function baseUrl() {
  return `https://mt-market-data-client-api-v1.${METAAPI_ACCOUNT.region}.agiliumtrade.ai`;
}

/** REST fetch with a hard 8s abort. Never retries — the caller skips the pair. */
async function restGet(path: string, token: string, symbol: string, timeframe: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method: "GET",
      headers: {
        "auth-token": token,
        "Content-Type": "application/json",
        application: METAAPI_ACCOUNT.application,
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`MetaApi ${res.status} for ${symbol} ${timeframe}: ${body.slice(0, 300)}`);
    }
    return (await res.json()) as unknown;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new MetaApiTimeoutError(symbol, timeframe);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

interface RawCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume?: number;
}

/** Historical OHLCV candles for one symbol/timeframe via the REST RPC endpoint. */
export async function fetchCandles(
  symbol: string,
  timeframe: Timeframe,
  limit = 200,
): Promise<Candle[]> {
  const token = process.env["METAAPI_TOKEN"];
  if (!token) throw new MetaApiNotConfiguredError();

  const path =
    `/users/current/accounts/${METAAPI_ACCOUNT.accountId}` +
    `/historical-market-data/symbols/${encodeURIComponent(symbol)}` +
    `/timeframes/${TF_MAP[timeframe]}/candles?limit=${limit}`;

  const raw = (await restGet(path, token, symbol, timeframe)) as RawCandle[] | null;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`MetaApi returned no candles for ${symbol} ${timeframe}`);
  }

  return raw
    .map((c) => ({
      time: c.time,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: c.tickVolume ?? 0,
    }))
    .filter((c) => Number.isFinite(c.close) && Number.isFinite(c.high) && Number.isFinite(c.low))
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}
