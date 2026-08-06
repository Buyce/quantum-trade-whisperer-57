import { atr, clamp, ema } from "./indicators";
import type { Bias, Candle, Grade, Timeframe, TimeframeRead } from "./types";

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

  return { timeframe, bias, barrierDistanceAtr, atr: a, atPointC };
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
