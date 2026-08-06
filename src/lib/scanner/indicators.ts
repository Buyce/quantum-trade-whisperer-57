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
  return { a, b, c, retracement, symmetry };
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
