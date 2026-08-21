/**
 * FROZEN pre-Prompt-7 scanner source — PROVENANCE:
 *   commit ab44ff687df4892745a47ffa1f3b737f04b478e0
 *   path   src/lib/scanner/indicators.ts
 *
 * TEST-ONLY. Never imported by application code. This copy is the
 * characterization baseline: it must NEVER be edited to make a test pass.
 * If current V1 differs from this file, the difference is reported, not patched.
 */
import type { Candle } from "./types";

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let acc = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i += 1) {
    acc = (values[i] as number) * k + acc * (1 - k);
  }
  return acc;
}

/** Wilder ATR. Returns 0 when there is not enough data to measure volatility. */
export function atr(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i] as Candle;
    const prev = candles[i - 1] as Candle;
    trs.push(
      Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)),
    );
  }
  let acc = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i += 1) {
    acc = (acc * (period - 1) + (trs[i] as number)) / period;
  }
  return acc;
}

/**
 * Historical Wilder ATR at a specific bar, using ONLY the candle prefix
 * `candles[0..i]`. This is exactly `atr()` evaluated on that prefix — same
 * seeding (arithmetic mean of the first `period` true ranges) and the same
 * recursion `ATR_t = ((period - 1) * ATR_{t-1} + TR_t) / period`.
 *
 * Fails closed with `null` rather than 0 so a caller can never mistake
 * "not measurable" for "no volatility":
 *  - index out of range, or fewer than `period + 1` bars in the prefix;
 *  - any non-finite OHLC value inside the prefix.
 *
 * Lookahead-free by construction: no index greater than `i` is ever read, so
 * appending future candles cannot change the returned value.
 */
export function atrAtIndex(candles: Candle[], i: number, period = 14): number | null {
  if (!Number.isInteger(i) || i < 0 || i >= candles.length) return null;
  if (!Number.isInteger(period) || period < 1) return null;
  if (i < period) return null;

  let acc = 0;
  for (let k = 1; k <= i; k += 1) {
    const c = candles[k] as Candle;
    const prev = candles[k - 1] as Candle;
    if (
      !Number.isFinite(c.high) ||
      !Number.isFinite(c.low) ||
      !Number.isFinite(c.close) ||
      !Number.isFinite(prev.close)
    ) {
      return null;
    }
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
    if (k <= period) acc += tr / period;
    else acc = (acc * (period - 1) + tr) / period;
  }
  return Number.isFinite(acc) ? acc : null;
}


export interface SwingPoint {
  index: number;
  price: number;
  kind: "high" | "low";
}

/** Fractal swing points using a symmetric lookback window. */
export function swings(candles: Candle[], lookback = 2): SwingPoint[] {
  const out: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i += 1) {
    const c = candles[i] as Candle;
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j += 1) {
      if (j === i) continue;
      const o = candles[j] as Candle;
      if (o.high >= c.high) isHigh = false;
      if (o.low <= c.low) isLow = false;
    }
    if (isHigh) out.push({ index: i, price: c.high, kind: "high" });
    else if (isLow) out.push({ index: i, price: c.low, kind: "low" });
  }
  return out;
}

/**
 * ABC retracement geometry. Point A is the impulse origin, B the impulse
 * extreme, C the retracement that is being tested for continuation.
 */
export interface AbcPattern {
  a: number;
  b: number;
  c: number;
  /** BC / AB retracement depth (0..1+). */
  retracement: number;
  /** 0..100 — how close the retracement is to the ideal 0.5-0.618 window. */
  symmetry: number;
  /** Candle timestamps of swings A and B — the stable identity of the leg. */
  aTime: string;
  bTime: string;
}

export function detectAbc(candles: Candle[], direction: "long" | "short"): AbcPattern | null {
  const pts = swings(candles, 2);
  if (pts.length < 3) return null;

  const wantB = direction === "long" ? "high" : "low";
  const wantA = direction === "long" ? "low" : "high";

  let bIdx = -1;
  for (let i = pts.length - 2; i >= 1; i -= 1) {
    if ((pts[i] as SwingPoint).kind === wantB) {
      bIdx = i;
      break;
    }
  }
  if (bIdx < 1) return null;

  let aIdx = -1;
  for (let i = bIdx - 1; i >= 0; i -= 1) {
    if ((pts[i] as SwingPoint).kind === wantA) {
      aIdx = i;
      break;
    }
  }
  if (aIdx < 0) return null;

  const a = (pts[aIdx] as SwingPoint).price;
  const b = (pts[bIdx] as SwingPoint).price;
  const last = candles[candles.length - 1] as Candle;
  const c = direction === "long" ? Math.min(...candles.slice(-6).map((x) => x.low)) : Math.max(...candles.slice(-6).map((x) => x.high));

  const ab = Math.abs(b - a);
  if (ab === 0) return null;
  const bc = Math.abs(b - c);
  const retracement = bc / ab;

  // Ideal ABC continuation retraces 0.5 - 0.618 of the AB leg.
  const ideal = 0.559;
  const symmetry = clamp(100 - (Math.abs(retracement - ideal) / 0.45) * 100, 0, 100);

  void last;
  const aCandle = candles[(pts[aIdx] as SwingPoint).index] as Candle | undefined;
  const bCandle = candles[(pts[bIdx] as SwingPoint).index] as Candle | undefined;
  return {
    a,
    b,
    c,
    retracement,
    symmetry,
    aTime: aCandle?.time ?? "",
    bTime: bCandle?.time ?? "",
  };
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Wilder RSI series aligned to `candles` (index 0..period are null-padded out
 * of the returned array — the series starts at the first computable bar).
 */
export function rsiSeries(candles: Candle[], period = 14): number[] {
  if (candles.length < period + 1) return [];
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const diff = (candles[i] as Candle).close - (candles[i - 1] as Candle).close;
    gains.push(Math.max(0, diff));
    losses.push(Math.max(0, -diff));
  }
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out: number[] = [rsiFrom(avgGain, avgLoss)];
  for (let i = period; i < gains.length; i += 1) {
    avgGain = (avgGain * (period - 1) + (gains[i] as number)) / period;
    avgLoss = (avgLoss * (period - 1) + (losses[i] as number)) / period;
    out.push(rsiFrom(avgGain, avgLoss));
  }
  return out;
}

function rsiFrom(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Latest RSI value, or null when there is not enough history. */
export function rsi(candles: Candle[], period = 14): number | null {
  const s = rsiSeries(candles, period);
  return s.length ? (s[s.length - 1] as number) : null;
}

/** Rolling Wilder ATR series, one value per bar from the warm-up onward. */
export function atrSeries(candles: Candle[], period = 14): number[] {
  if (candles.length < period + 1) return [];
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i] as Candle;
    const prev = candles[i - 1] as Candle;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)));
  }
  let acc = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = [acc];
  for (let i = period; i < trs.length; i += 1) {
    acc = (acc * (period - 1) + (trs[i] as number)) / period;
    out.push(acc);
  }
  return out;
}

/** Simple moving average of the ATR series — the volatility expansion baseline. */
export function atrMovingAverage(candles: Candle[], atrPeriod = 14, maPeriod = 20): number | null {
  const series = atrSeries(candles, atrPeriod);
  return sma(series, maPeriod);
}

/**
 * Institutional order block (supply/demand zone).
 *
 * Definition used here, documented so future tuning stays unambiguous:
 * the last opposing-close candle immediately preceding an impulsive
 * displacement leg that breaks the prior swing structure. The zone is that
 * candle's full high-low range. A block is treated as mitigated (and dropped)
 * once price has fully traded through the far side of the zone afterwards.
 */
export interface OrderBlock {
  kind: "demand" | "supply";
  low: number;
  high: number;
  index: number;
  /** Size of the displacement leg that created the block, in ATR units. */
  displacementAtr: number;
}

export function detectOrderBlocks(
  candles: Candle[],
  kind: "demand" | "supply",
  opts: { minDisplacementAtr?: number; maxBlocks?: number } = {},
): OrderBlock[] {
  const minDisp = opts.minDisplacementAtr ?? 1.2;
  const maxBlocks = opts.maxBlocks ?? 6;
  const a = atr(candles, 14);
  if (a <= 0 || candles.length < 25) return [];

  const blocks: OrderBlock[] = [];
  // Single forward pass: find displacement legs, then take the last opposing
  // candle before each leg as the block.
  for (let i = 3; i < candles.length - 1; i += 1) {
    const c = candles[i] as Candle;
    const bullish = c.close > c.open;
    if (kind === "demand" ? !bullish : bullish) continue;

    const body = Math.abs(c.close - c.open);
    const displacementAtr = body / a;
    if (displacementAtr < minDisp) continue;

    // Structure break confirmation against the 10 bars before the leg.
    const priorWindow = candles.slice(Math.max(0, i - 10), i);
    if (!priorWindow.length) continue;
    const priorHigh = Math.max(...priorWindow.map((x) => x.high));
    const priorLow = Math.min(...priorWindow.map((x) => x.low));
    if (kind === "demand" ? c.close <= priorHigh : c.close >= priorLow) continue;

    // Last opposing-close candle immediately before the displacement.
    let originIdx = -1;
    for (let j = i - 1; j >= Math.max(0, i - 5); j -= 1) {
      const o = candles[j] as Candle;
      const oppose = kind === "demand" ? o.close < o.open : o.close > o.open;
      if (oppose) {
        originIdx = j;
        break;
      }
    }
    if (originIdx < 0) continue;
    const origin = candles[originIdx] as Candle;

    // Mitigation: dropped once price fully traded through the far side.
    const after = candles.slice(i + 1);
    const mitigated =
      kind === "demand"
        ? after.some((x) => x.low < origin.low)
        : after.some((x) => x.high > origin.high);
    if (mitigated) continue;

    blocks.push({
      kind,
      low: origin.low,
      high: origin.high,
      index: originIdx,
      displacementAtr,
    });
  }

  return blocks.slice(-maxBlocks);
}

/** Distance from `price` to a zone in ATR units. 0 when price sits inside it. */
export function zoneDistanceAtr(block: OrderBlock, price: number, atrValue: number): number {
  if (atrValue <= 0) return Number.POSITIVE_INFINITY;
  if (price >= block.low && price <= block.high) return 0;
  const gap = price < block.low ? block.low - price : price - block.high;
  return gap / atrValue;
}

export function zoneContains(block: OrderBlock, price: number): boolean {
  return price >= block.low && price <= block.high;
}
