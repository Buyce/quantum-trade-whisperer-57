/**
 * V2 canonical ABC geometry (research model version 2).
 *
 * Deliberately independent of V1's `detectAbc`, which has no retracement band,
 * derives C from a fixed 6-bar window regardless of where B sits, and can pair
 * an A/B whose leg points the wrong way.
 *
 * Selection is a SINGLE deterministic pass — never a search until something
 * qualifies, which would be parameter fitting dressed up as detection:
 *   1. B = the most recent confirmed pivot of the required kind
 *          (high for long, low for short).
 *   2. A = the nearest PRECEDING confirmed opposite-kind pivot whose leg points
 *          the right way (B above A for long, mirrored for short).
 *   3. C = the retracement extreme strictly AFTER B's bar, taken from the
 *          delivered candle snapshot (see docs/CHARACTERISATION.md for whether
 *          that snapshot includes a forming bar).
 *   4. If that one triple fails chronology, bounds or the retracement band, the
 *          answer is "no valid continuation". No fallback to older pairs.
 */
import { swings, type SwingPoint } from "../indicators";
import type { Candle, Direction } from "../types";

/** Mandatory retracement band for a V2 continuation. */
export const RETRACEMENT_MIN = 0.382;
export const RETRACEMENT_MAX = 0.886;
/** Fractal window used to confirm A and B. Same window as V1's `swings`. */
export const PIVOT_LOOKBACK = 2;

export interface AbcV2 {
  a: number;
  b: number;
  c: number;
  aIndex: number;
  bIndex: number;
  cIndex: number;
  aTime: string;
  bTime: string;
  /** (B - C) / (B - A) for a long; mirrored for a short. Always in (0, 1). */
  retracement: number;
  /** Diagnostic only — never scored. Closeness to the 0.5-0.618 window. */
  symmetry: number;
}

function finiteCandle(c: Candle | undefined): c is Candle {
  return (
    !!c &&
    Number.isFinite(c.open) &&
    Number.isFinite(c.high) &&
    Number.isFinite(c.low) &&
    Number.isFinite(c.close)
  );
}

export function detectAbcV2(candles: Candle[], direction: Direction): AbcV2 | null {
  if (!Array.isArray(candles) || candles.length < 3 * PIVOT_LOOKBACK + 2) return null;
  if (!candles.every(finiteCandle)) return null;

  const pivots = swings(candles, PIVOT_LOOKBACK);
  if (pivots.length < 2) return null;

  const wantB = direction === "long" ? "high" : "low";
  const wantA = direction === "long" ? "low" : "high";

  // 1. Most recent confirmed pivot of B's kind.
  let b: SwingPoint | null = null;
  for (let i = pivots.length - 1; i >= 0; i -= 1) {
    const p = pivots[i] as SwingPoint;
    if (p.kind === wantB) {
      b = p;
      break;
    }
  }
  if (!b) return null;

  // 2. Nearest preceding opposite pivot with a correctly signed, non-zero leg.
  let a: SwingPoint | null = null;
  for (let i = pivots.indexOf(b) - 1; i >= 0; i -= 1) {
    const p = pivots[i] as SwingPoint;
    if (p.kind !== wantA) continue;
    const legOk = direction === "long" ? b.price > p.price : b.price < p.price;
    if (legOk) a = p;
    break; // nearest preceding opposite pivot only — no searching past it
  }
  if (!a) return null;
  if (a.index >= b.index) return null;

  const ab = direction === "long" ? b.price - a.price : a.price - b.price;
  if (!(ab > 0)) return null;

  // 3. C from bars strictly after B.
  const after = candles.slice(b.index + 1);
  if (!after.length) return null;
  let cIndex = b.index + 1;
  let c = direction === "long" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  after.forEach((candle, offset) => {
    const value = direction === "long" ? candle.low : candle.high;
    const better = direction === "long" ? value < c : value > c;
    if (better) {
      c = value;
      cIndex = b.index + 1 + offset;
    }
  });
  if (!Number.isFinite(c)) return null;

  // 4. Strict bounds, then the band. Order matters: bounds guarantee (0, 1).
  const inBounds = direction === "long" ? a.price < c && c < b.price : b.price < c && c < a.price;
  if (!inBounds) return null;

  const bc = direction === "long" ? b.price - c : c - b.price;
  const retracement = bc / ab;
  if (!Number.isFinite(retracement) || retracement <= 0 || retracement >= 1) return null;
  if (retracement < RETRACEMENT_MIN || retracement > RETRACEMENT_MAX) return null;

  const ideal = 0.559;
  const symmetry = Math.min(100, Math.max(0, 100 - (Math.abs(retracement - ideal) / 0.45) * 100));

  return {
    a: a.price,
    b: b.price,
    c,
    aIndex: a.index,
    bIndex: b.index,
    cIndex,
    aTime: (candles[a.index] as Candle).time,
    bTime: (candles[b.index] as Candle).time,
    retracement,
    symmetry,
  };
}
