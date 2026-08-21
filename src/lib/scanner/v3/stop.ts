/**
 * V3 leg-scoped stop anchor (research model version 3).
 *
 * V1 and V2 anchor the stop on the extreme of the LAST TEN M15 candles, a window
 * that has nothing to do with the detected leg: it can sit before Point A or
 * exclude the retracement entirely, so two identical structures get different
 * risk depending on where the fetch window happened to end.
 *
 * V3 anchors on the retracement leg itself — the bars strictly after Point B up
 * to and including Point C — which is the only region whose violation falsifies
 * the setup. Buffer constants are inherited from V1 unchanged (1.2x M15 ATR,
 * 0.5x H1 ATR floor, per-instrument spread floor).
 */
import {
  DEFAULT_SPREAD_FLOOR,
  SPREAD_FLOOR,
  STOP_H1_ATR_FLOOR,
  STOP_M15_ATR_MULTIPLIER,
  type Candle,
  type Direction,
} from "../types";

export const V3_STOP_PARAMS = {
  window: "(bIndex + 1) .. cIndex inclusive — the retracement leg only",
  m15AtrMultiplier: STOP_M15_ATR_MULTIPLIER,
  h1AtrFloor: STOP_H1_ATR_FLOOR,
  spreadFloor: "per-instrument SPREAD_FLOOR, DEFAULT_SPREAD_FLOOR fallback",
  inheritedFrom: "v1",
} as const;

export interface V3Stop {
  stopLoss: number;
  anchor: number;
  buffer: number;
  bars: number;
}

/**
 * Returns null when the leg window is empty or the inputs are not measurable —
 * V3 never falls back to a different window.
 */
export function legScopedStop(args: {
  instrument: string;
  direction: Direction;
  candles: Candle[];
  bIndex: number;
  cIndex: number;
  m15Atr: number;
  h1Atr: number;
}): V3Stop | null {
  const { candles, bIndex, cIndex } = args;
  const from = bIndex + 1;
  if (!Number.isInteger(from) || !Number.isInteger(cIndex)) return null;
  if (from < 0 || cIndex < from || cIndex >= candles.length) return null;
  if (!Number.isFinite(args.m15Atr) || !(args.m15Atr > 0)) return null;

  const leg = candles.slice(from, cIndex + 1);
  if (leg.length === 0) return null;

  const anchor =
    args.direction === "long"
      ? Math.min(...leg.map((c) => c.low))
      : Math.max(...leg.map((c) => c.high));
  if (!Number.isFinite(anchor)) return null;

  const spreadFloor = SPREAD_FLOOR[args.instrument] ?? DEFAULT_SPREAD_FLOOR;
  const h1Floor = Number.isFinite(args.h1Atr) ? args.h1Atr * STOP_H1_ATR_FLOOR : 0;
  const buffer = Math.max(args.m15Atr * STOP_M15_ATR_MULTIPLIER, h1Floor, spreadFloor);

  return {
    stopLoss: args.direction === "long" ? anchor - buffer : anchor + buffer,
    anchor,
    buffer,
    bars: leg.length,
  };
}
