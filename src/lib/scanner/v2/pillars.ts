/**
 * V2 pillar scoring (research model version 2).
 *
 * Reuses V1's `scoreConfluence` for pillars 1 (trend) and 3 (momentum) verbatim
 * — those are unchanged in V2 — and overrides the two that are mathematically
 * wrong in V1:
 *
 *  - Pillar 2 (displacement-origin zone): V1 measures the distance from Point C
 *    to an H1 or H4 zone in M15 ATR units, so an H4 zone is judged on a
 *    volatility scale ~4x too small and effectively never scores. V2 normalises
 *    each zone by the Wilder ATR of its OWN timeframe at the bar that created it
 *    (`atrAtIndex`, prefix-only, no lookahead).
 *  - Pillar 4 (volatility expansion): V1's step function jumps 20 points at
 *    ratio 1.0. V2 uses the continuous transform in `./volatility`.
 *
 * V1 is not modified; this module only recomputes two components and rebuilds
 * `passed` and `notes`.
 */
import { atrAtIndex, atrMovingAverage, clamp, detectOrderBlocks, type OrderBlock } from "../indicators";
import { scoreConfluence } from "../grading";
import { PILLAR_PASS_SCORE, type Candle, type Direction, type PillarScores } from "../types";
import { volatilityScoreV2 } from "./volatility";

/** Zone proximity beyond which the pillar scores 0, in native ATR units. */
export const ZONE_MAX_DISTANCE_ATR = 1.5;

function zoneDistance(zone: OrderBlock, price: number): number {
  if (price >= zone.low && price <= zone.high) return 0;
  return price < zone.low ? zone.low - price : price - zone.high;
}

/** Nearest displacement-origin zone to Point C, normalised per timeframe. */
export function nearestZoneDistanceAtrV2(args: {
  direction: Direction;
  pointC: number;
  h1Candles: Candle[];
  h4Candles: Candle[];
}): { distanceAtr: number; zones: number } {
  const kind = args.direction === "long" ? "demand" : "supply";
  const sources: Array<{ candles: Candle[]; blocks: OrderBlock[] }> = [
    { candles: args.h1Candles, blocks: detectOrderBlocks(args.h1Candles, kind) },
    { candles: args.h4Candles, blocks: detectOrderBlocks(args.h4Candles, kind) },
  ];

  let best = Number.POSITIVE_INFINITY;
  let zones = 0;
  for (const source of sources) {
    for (const zone of source.blocks) {
      zones += 1;
      // Native-timeframe normalisation: the zone's own volatility at its own bar.
      const nativeAtr = atrAtIndex(source.candles, zone.index, 14);
      if (nativeAtr === null || !(nativeAtr > 0)) continue;
      const d = zoneDistance(zone, args.pointC) / nativeAtr;
      if (d < best) best = d;
    }
  }
  return { distanceAtr: best, zones };
}

export function scoreConfluenceV2(input: {
  direction: Direction;
  pointC: number;
  alignmentScore: number;
  allAligned: boolean;
  h4Candles: Candle[];
  h1Candles: Candle[];
  m15Candles: Candle[];
  m15Atr: number;
}): PillarScores {
  const v1 = scoreConfluence(input);

  // ---- Pillar 2 (V2) -----------------------------------------------------
  const { distanceAtr, zones } = nearestZoneDistanceAtrV2(input);
  const orderBlock = Number.isFinite(distanceAtr)
    ? distanceAtr === 0
      ? 100
      : clamp(100 - (distanceAtr / ZONE_MAX_DISTANCE_ATR) * 60, 0, 100)
    : 0;

  // ---- Pillar 4 (V2) -----------------------------------------------------
  const atrMa = atrMovingAverage(input.m15Candles, 14, 20);
  const ratio = atrMa && atrMa > 0 && input.m15Atr > 0 ? input.m15Atr / atrMa : 0;
  const volatilityExpansion = volatilityScoreV2(ratio);

  const notes = [
    v1.notes[0] ??
      `Trend alignment: ${input.allAligned ? "all timeframes agree" : "higher timeframes disagree"}`,
    !zones
      ? "Displacement zone: no unmitigated H1/H4 displacement-origin zone in range"
      : distanceAtr === 0
        ? "Displacement zone: Point C is inside an unmitigated H1/H4 displacement-origin zone"
        : `Displacement zone: Point C sits ${distanceAtr.toFixed(2)} native ATR from the nearest displacement-origin zone`,
    v1.notes[2] ?? "Momentum: no reading",
    ratio > 0
      ? `Volatility: M15 ATR is ${ratio.toFixed(2)}x its 20-period average (continuous transform)`
      : "Volatility: M15 ATR ratio not measurable",
  ];

  const scores = {
    trend: v1.trend,
    orderBlock: Math.round(orderBlock * 10) / 10,
    momentum: v1.momentum,
    volatilityExpansion: Math.round(volatilityExpansion * 10) / 10,
  };

  return {
    ...scores,
    passed: Object.values(scores).filter((v) => v >= PILLAR_PASS_SCORE).length,
    notes,
  };
}
