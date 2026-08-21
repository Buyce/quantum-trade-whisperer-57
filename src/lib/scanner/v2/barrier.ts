/**
 * V2 canonical H4 barrier (research model version 2).
 *
 * V1 uses TWO different H4 barriers: `directionalHeadroomAtr` (nearest unbroken
 * major pivot ahead, infinite when open space) decides the grade, while the
 * R-multiple cascade uses `rangeHigh`/`rangeLow` (the extreme of the 60-bar H4
 * window). A setup can therefore be graded on open space and then have its
 * targets capped by an unrelated level. V2 uses ONE definition for both.
 *
 * Definition: the nearest opposing H4 swing pivot ahead of price that has never
 * been closed through, using the same fractal window and noise band as V1's
 * headroom measure. When no such pivot exists the structure is in open space and
 * the barrier is synthesised at a fixed ATR extension from the entry, so maxR is
 * finite and bounded instead of infinite.
 */
import { swings } from "../indicators";
import type { Candle, Direction } from "../types";

/** Same fractal window and noise band as V1's directional headroom measure. */
export const H4_PIVOT_LOOKBACK = 5;
export const PIVOT_MIN_SEPARATION_ATR = 0.3;
/** Open space is capped here so an unbounded barrier can never produce maxR = Infinity. */
export const OPEN_SPACE_EXTENSION_ATR = 6;

export interface CanonicalBarrier {
  /** Absolute price of the barrier used for BOTH the grade and the R cascade. */
  price: number;
  source: "structure" | "open_space_extension";
  /** Distance from the reference price to the barrier, in H4 ATR units. */
  headroomAtr: number;
}

/**
 * Nearest unbroken opposing H4 pivot ahead of `price`, or null in open space.
 */
export function structuralBarrier(
  direction: Direction,
  h4Candles: Candle[],
  h4Atr: number,
  price: number,
): number | null {
  if (!(h4Atr > 0) || !Number.isFinite(price)) return null;
  const band = PIVOT_MIN_SEPARATION_ATR * h4Atr;

  const opposing = swings(h4Candles, H4_PIVOT_LOOKBACK)
    .filter((p) => {
      if (direction === "long") {
        if (p.kind !== "high" || p.price <= price + band) return false;
        return !h4Candles.slice(p.index + 1).some((c) => c.close > p.price);
      }
      if (p.kind !== "low" || p.price >= price - band) return false;
      return !h4Candles.slice(p.index + 1).some((c) => c.close < p.price);
    })
    .map((p) => p.price);

  if (!opposing.length) return null;
  return direction === "long" ? Math.min(...opposing) : Math.max(...opposing);
}

/**
 * The single V2 barrier. `reference` is the price headroom is measured from
 * (the last H4 close); `anchor` is where the open-space extension is measured
 * from (the entry), so the R cascade is anchored to the trade, not to H4's close.
 */
export function canonicalBarrier(args: {
  direction: Direction;
  h4Candles: Candle[];
  h4Atr: number;
  reference: number;
  anchor: number;
}): CanonicalBarrier | null {
  const { direction, h4Candles, h4Atr, reference, anchor } = args;
  if (!(h4Atr > 0) || !Number.isFinite(reference) || !Number.isFinite(anchor)) return null;
  const sign = direction === "long" ? 1 : -1;

  const structure = structuralBarrier(direction, h4Candles, h4Atr, reference);
  if (structure !== null) {
    return {
      price: structure,
      source: "structure",
      headroomAtr: Math.abs(structure - reference) / h4Atr,
    };
  }

  const price = anchor + sign * OPEN_SPACE_EXTENSION_ATR * h4Atr;
  return {
    price,
    source: "open_space_extension",
    headroomAtr: OPEN_SPACE_EXTENSION_ATR,
  };
}
