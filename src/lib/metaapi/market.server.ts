/**
 * Market data reads (historical candles, current price).
 *
 * REST/RPC semantics only — a streaming connection keeps terminal state in
 * memory and silently desynchronises inside short-lived serverless invocations.
 */
import type { Candle, Timeframe } from "@/lib/scanner/types";
import { withBenchmarkAccount } from "./benchmark.server";
import { withMarketDataSlot } from "./market-gate.server";
import { validQuoteGeometry } from "./quote";
import { metaApiRequest } from "./request.server";

const TF_MAP: Record<Timeframe, string> = { H4: "4h", H1: "1h", M15: "15m" };

interface RawCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume?: number;
}

export interface BrokerQuote {
  bid: number;
  ask: number;
  /**
   * Broker-supplied source timestamp, or NULL when MetaApi omitted it or sent
   * something unparseable. Never substituted with local time: a fabricated
   * timestamp would let a stale price back a real position size.
   */
  sourceTime: string | null;
  /** When this process received the response (display/diagnostics only). */
  receivedAt: string;
}

/**
 * Historical OHLCV candles for one symbol/timeframe on a given account.
 *
 * `startTime` reads a WINDOW OF THE PAST instead of the live tail: MetaApi loads
 * candles backwards from that instant, so `startTime` is the newest bar of the
 * returned window. Research replay needs this — a structure detected ten days
 * ago cannot be adjudicated from the most recent 200 bars, and quietly replaying
 * it against the wrong bars would manufacture an outcome that never happened.
 */
export async function fetchCandlesFor(
  accountId: string,
  region: string,
  symbol: string,
  timeframe: Timeframe,
  limit = 200,
  startTime?: string | null,
): Promise<Candle[]> {
  // Gated: the provider allows only 5 concurrent historical reads per account.
  const raw = await withMarketDataSlot(() =>
    metaApiRequest<RawCandle[]>({
      service: "market-data",
      region,
      label: startTime ? `${symbol} ${timeframe} @${startTime}` : `${symbol} ${timeframe}`,
      path:
        `/users/current/accounts/${accountId}` +
        `/historical-market-data/symbols/${encodeURIComponent(symbol)}` +
        `/timeframes/${TF_MAP[timeframe]}/candles?limit=${limit}` +
        (startTime ? `&startTime=${encodeURIComponent(startTime)}` : ""),
    }),
  );

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

/** Historical candles from the P-Trades benchmark account (the scanner's feed). */
export async function fetchCandles(
  symbol: string,
  timeframe: Timeframe,
  limit = 200,
  startTime?: string | null,
): Promise<Candle[]> {
  return await withBenchmarkAccount(({ accountId, region }) =>
    fetchCandlesFor(accountId, region, symbol, timeframe, limit, startTime),
  );
}

interface RawPrice {
  time?: string;
  bid?: number;
  ask?: number;
}

export async function fetchQuoteFor(
  accountId: string,
  region: string,
  symbol: string,
): Promise<BrokerQuote | null> {
  const raw = await metaApiRequest<RawPrice>({
    service: "client",
    region,
    label: `${symbol} quote`,
    path:
      `/users/current/accounts/${accountId}` +
      `/symbols/${encodeURIComponent(symbol)}/current-price?keepSubscription=false`,
  });

  const bid = Number(raw?.bid);
  const ask = Number(raw?.ask);
  if (!validQuoteGeometry(bid, ask)) return null;
  const parsed = raw?.time ? Date.parse(raw.time) : Number.NaN;
  return {
    bid,
    ask,
    sourceTime: Number.isFinite(parsed) ? new Date(parsed).toISOString() : null,
    receivedAt: new Date().toISOString(),
  };
}

/**
 * Current bid/ask from the benchmark account. Used only by the shared, cached
 * quotes endpoint — never per client, never inside the scanner.
 */
export async function fetchQuote(symbol: string): Promise<BrokerQuote | null> {
  return await withBenchmarkAccount(({ accountId, region }) =>
    fetchQuoteFor(accountId, region, symbol),
  );
}
