import {
  atr,
  atrMovingAverage,
  clamp,
  detectOrderBlocks,
  ema,
  rsiSeries,
  zoneDistanceAtr,
} from "./indicators";
import {
  PILLAR_PASS_SCORE,
  type Bias,
  type Candle,
  type Grade,
  type PillarScores,
  type Timeframe,
  type TimeframeRead,
} from "./types";


/**
 * Moving-average structure read for one timeframe. Bias requires the fast,
 * mid and slow EMA stack to agree, otherwise the timeframe is neutral.
 */
export function readTimeframe(timeframe: Timeframe, candles: Candle[]): TimeframeRead {
  const closes = candles.map((c) => c.close);
  const fast = ema(closes, 20);
  const mid = ema(closes, 50);
  const slow = ema(closes, 200) ?? ema(closes, 100);
  const a = atr(candles, 14);
  const price = closes[closes.length - 1] ?? 0;

  let bias: Bias = "neutral";
  if (fast !== null && mid !== null && slow !== null) {
    if (fast > mid && mid > slow && price > fast) bias = "bullish";
    else if (fast < mid && mid < slow && price < fast) bias = "bearish";
  }

  // Macro barrier = extreme of the recent higher-timeframe range.
  const window = candles.slice(-60);
  const rangeHigh = window.length ? Math.max(...window.map((c) => c.high)) : price;
  const rangeLow = window.length ? Math.min(...window.map((c) => c.low)) : price;
  const barrier = bias === "bearish" ? rangeLow : rangeHigh;
  const barrierDistanceAtr = a > 0 ? Math.abs(barrier - price) / a : 0;

  // Point C: price is pulling back into the discount half of the recent leg.
  const legMid = (rangeHigh + rangeLow) / 2;
  const atPointC =
    bias === "bullish" ? price <= legMid + a * 0.75 : bias === "bearish" ? price >= legMid - a * 0.75 : false;

  return { timeframe, bias, barrierDistanceAtr, barrierPrice: barrier, atr: a, atPointC };
}

export interface GradeResult {
  grade: Grade | null;
  reasonsSatisfied: string[];
  reasonsViolated: string[];
  alignmentScore: number;
}

/**
 * Tier grading over the ABC retracement structure.
 *
 * A — perfect MA alignment across H4/H1/M15 and price testing Point C.
 * B — H1 + M15 aligned with the primary trend but H4 approaching macro resistance.
 * C — aggressive localized M15 break against conflicting higher timeframes.
 */
export function gradeSetup(h4: TimeframeRead, h1: TimeframeRead, m15: TimeframeRead): GradeResult {
  const satisfied: string[] = [];
  const violated: string[] = [];

  const allAligned = h4.bias !== "neutral" && h4.bias === h1.bias && h1.bias === m15.bias;
  const h1m15Aligned = h1.bias !== "neutral" && h1.bias === m15.bias;
  const nearMacroBarrier = h4.barrierDistanceAtr < 2.5;

  if (allAligned) satisfied.push("Moving-average stack aligned across H4, H1 and M15");
  else violated.push("Moving-average stack is not aligned across all three timeframes");

  if (m15.atPointC || h1.atPointC) satisfied.push("Price is testing the Point C structural liquidity zone");
  else violated.push("Price is not reacting inside a Point C liquidity zone");

  if (!nearMacroBarrier) satisfied.push("H4 has clear room before the next macro barrier");
  else violated.push("H4 is approaching major macroeconomic resistance");

  let grade: Grade | null = null;
  if (allAligned && (m15.atPointC || h1.atPointC) && !nearMacroBarrier) grade = "A";
  else if (h1m15Aligned && nearMacroBarrier) grade = "B";
  else if (h1m15Aligned) grade = "B";
  else if (m15.bias !== "neutral") grade = "C";

  const agreeing = [h4.bias, h1.bias, m15.bias].filter((b) => b === m15.bias && b !== "neutral").length;
  const alignmentScore = clamp(
    agreeing === 3 ? 92 + (h4.atPointC ? 6 : 0) : agreeing === 2 ? 74 : 45,
    0,
    100,
  );

  return { grade, reasonsSatisfied: satisfied, reasonsViolated: violated, alignmentScore };
}

/**
 * Institutional Confluence Scoring — the four pillars, each scored 0-100.
 *
 * Pillar 1 Trend alignment      — H4/H1/M15 moving-average stacks agree.
 * Pillar 2 Order block retest   — Point C sits inside an H1/H4 institutional zone.
 * Pillar 3 Momentum exhaustion  — M15 RSI extreme or divergence at Point C.
 * Pillar 4 Volatility expansion — M15 ATR at/above its 20-period ATR average.
 */
export function scoreConfluence(input: {
  direction: "long" | "short";
  pointC: number;
  alignmentScore: number;
  allAligned: boolean;
  h4Candles: Candle[];
  h1Candles: Candle[];
  m15Candles: Candle[];
  m15Atr: number;
}): PillarScores {
  const notes: string[] = [];

  // ---- Pillar 1: trend alignment -----------------------------------------
  const trend = input.allAligned ? clamp(input.alignmentScore, 0, 100) : clamp(input.alignmentScore * 0.6, 0, 100);
  notes.push(
    input.allAligned
      ? `Trend alignment: H4, H1 and M15 stacks all point ${input.direction === "long" ? "up" : "down"} (${trend.toFixed(0)}%)`
      : `Trend alignment: higher timeframes disagree with the M15 read (${trend.toFixed(0)}%)`,
  );

  // ---- Pillar 2: order block retest --------------------------------------
  const zoneKind = input.direction === "long" ? "demand" : "supply";
  const blocks = [
    ...detectOrderBlocks(input.h1Candles, zoneKind),
    ...detectOrderBlocks(input.h4Candles, zoneKind),
  ];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const b of blocks) {
    const d = zoneDistanceAtr(b, input.pointC, input.m15Atr);
    if (d < bestDistance) bestDistance = d;
  }
  const orderBlock = Number.isFinite(bestDistance)
    ? bestDistance === 0
      ? 100
      : clamp(100 - (bestDistance / 1.5) * 60, 0, 100)
    : 0;
  notes.push(
    !blocks.length
      ? "Order block: no unmitigated H1/H4 institutional zone in range"
      : bestDistance === 0
        ? "Order block: Point C is retesting an unmitigated H1/H4 institutional zone"
        : `Order block: Point C sits ${bestDistance.toFixed(2)} ATR from the nearest institutional zone`,
  );

  // ---- Pillar 3: momentum exhaustion -------------------------------------
  const rsiVals = rsiSeries(input.m15Candles, 14);
  const recentRsi = rsiVals.slice(-6);
  const latestRsi = recentRsi[recentRsi.length - 1] ?? 50;
  const extremeRsi =
    input.direction === "long" ? Math.min(...(recentRsi.length ? recentRsi : [50])) : Math.max(...(recentRsi.length ? recentRsi : [50]));
  // Long wants an oversold flush into Point C; short wants an overbought push.
  const extremeScore =
    input.direction === "long"
      ? clamp(((40 - extremeRsi) / 20) * 100, 0, 100)
      : clamp(((extremeRsi - 60) / 20) * 100, 0, 100);

  // Divergence: price made a new extreme while RSI did not.
  const priceWindow = input.m15Candles.slice(-12);
  const half = Math.floor(priceWindow.length / 2);
  const rsiWindow = rsiVals.slice(-12);
  let divergence = false;
  if (priceWindow.length >= 8 && rsiWindow.length >= 8) {
    const firstPrice = priceWindow.slice(0, half);
    const lastPrice = priceWindow.slice(half);
    const firstRsi = rsiWindow.slice(0, half);
    const lastRsi = rsiWindow.slice(half);
    if (input.direction === "long") {
      divergence =
        Math.min(...lastPrice.map((c) => c.low)) < Math.min(...firstPrice.map((c) => c.low)) &&
        Math.min(...lastRsi) > Math.min(...firstRsi);
    } else {
      divergence =
        Math.max(...lastPrice.map((c) => c.high)) > Math.max(...firstPrice.map((c) => c.high)) &&
        Math.max(...lastRsi) < Math.max(...firstRsi);
    }
  }
  const momentum = clamp(Math.max(extremeScore, divergence ? 75 : 0), 0, 100);
  notes.push(
    divergence
      ? `Momentum: ${input.direction === "long" ? "bullish" : "bearish"} RSI divergence at Point C (RSI ${latestRsi.toFixed(1)})`
      : extremeScore >= PILLAR_PASS_SCORE
        ? `Momentum: RSI reached an exhaustion extreme of ${extremeRsi.toFixed(1)} into Point C`
        : `Momentum: no RSI exhaustion or divergence at Point C (RSI ${latestRsi.toFixed(1)})`,
  );

  // ---- Pillar 4: volatility expansion ------------------------------------
  const atrMa = atrMovingAverage(input.m15Candles, 14, 20);
  const ratio = atrMa && atrMa > 0 ? input.m15Atr / atrMa : 0;
  const volatilityExpansion = ratio <= 0 ? 0 : ratio >= 1 ? clamp(80 + (ratio - 1) * 100, 0, 100) : clamp(ratio * 60, 0, 100);
  notes.push(
    ratio >= 1
      ? `Volatility: M15 ATR is ${ratio.toFixed(2)}x its 20-period average — range is expanding`
      : `Volatility: M15 ATR is only ${ratio.toFixed(2)}x its 20-period average — range is compressing`,
  );

  const scores = { trend, orderBlock, momentum, volatilityExpansion };
  const passed = Object.values(scores).filter((v) => v >= PILLAR_PASS_SCORE).length;

  return {
    trend: Math.round(trend * 10) / 10,
    orderBlock: Math.round(orderBlock * 10) / 10,
    momentum: Math.round(momentum * 10) / 10,
    volatilityExpansion: Math.round(volatilityExpansion * 10) / 10,
    passed,
    notes,
  };
}
