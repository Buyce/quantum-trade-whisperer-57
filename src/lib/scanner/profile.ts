import { clamp, detectAbc } from "./indicators";
import { gradeSetup, readTimeframe } from "./grading";
import {
  CONFIDENCE_WEIGHTS,
  type Candle,
  type ConfidenceBreakdown,
  type Direction,
  type Grade,
  type TradeProfile,
  type TimeframeRead,
} from "./types";

export function scoreConfidence(input: {
  alignment: number;
  rrRatio: number;
  symmetry: number;
  volatilityAtrRatio: number;
}): ConfidenceBreakdown {
  const alignment = clamp(input.alignment, 0, 100);
  const rr = clamp((input.rrRatio / 3) * 100, 0, 100);
  const symmetry = clamp(input.symmetry, 0, 100);
  // Healthy expansion sits near 1x average ATR; too dead or too wild both score down.
  const volatility = clamp(100 - Math.abs(input.volatilityAtrRatio - 1) * 90, 0, 100);
  const score =
    alignment * CONFIDENCE_WEIGHTS.alignment +
    rr * CONFIDENCE_WEIGHTS.rr +
    symmetry * CONFIDENCE_WEIGHTS.symmetry +
    volatility * CONFIDENCE_WEIGHTS.volatility;
  return {
    alignment: round(alignment),
    rr: round(rr),
    symmetry: round(symmetry),
    volatility: round(volatility),
    score: round(score),
  };
}

export function buildBreakdown(args: {
  grade: Grade;
  direction: Direction;
  satisfied: string[];
  violated: string[];
  symmetry: number;
  alignment: number;
  rrRatio: number;
  atr: number;
}): string {
  const dirw = args.direction === "long" ? "bullish" : "bearish";
  const head =
    args.grade === "A"
      ? `A-Grade: full ${dirw} continuation structure. Every tier rule is satisfied.`
      : args.grade === "B"
        ? `B-Grade: primary ${dirw} trend alignment on H1 and M15, but H4 context caps the extension.`
        : `C-Grade: aggressive localized M15 ${dirw} structural break with conflicting higher timeframes — mean-reversion only.`;

  const sat = args.satisfied.length
    ? `Rules satisfied: ${args.satisfied.join("; ")}.`
    : "Rules satisfied: none of the tier-A structural rules were met.";
  const vio = args.violated.length ? `Rules violated: ${args.violated.join("; ")}.` : "Rules violated: none.";

  const metrics = `Pattern symmetry ${args.symmetry.toFixed(1)}%, timeframe alignment ${args.alignment.toFixed(1)}%, planned R:R ${args.rrRatio.toFixed(2)} with a stop placed beyond the structural extreme plus a ${args.atr.toFixed(5)} ATR buffer.`;

  const advice =
    args.grade === "A"
      ? "Full 1:3 extension is on the table."
      : args.grade === "B"
        ? "Manage to 1:2 unless H4 clears its barrier."
        : "Default philosophy is No Trade unless the volatility context is exceptional.";

  return `${head} ${sat} ${vio} ${metrics} ${advice}`;
}

export interface BuildProfileInput {
  instrument: string;
  candles: Record<"H4" | "H1" | "M15", Candle[]>;
}

/**
 * Turns raw OHLCV candles into a Phase-2 Trade Profile, or null when the
 * market offers no qualifying setup (the No-Trade default).
 */
export function buildTradeProfile(input: BuildProfileInput): TradeProfile | null {
  const h4 = readTimeframe("H4", input.candles.H4);
  const h1 = readTimeframe("H1", input.candles.H1);
  const m15 = readTimeframe("M15", input.candles.M15);

  const graded = gradeSetup(h4, h1, m15);
  if (!graded.grade || m15.bias === "neutral") return null;

  const direction: Direction = m15.bias === "bullish" ? "long" : "short";
  const abc = detectAbc(input.candles.M15, direction);
  if (!abc) return null;

  const m15Candles = input.candles.M15;
  const last = m15Candles[m15Candles.length - 1] as Candle | undefined;
  if (!last) return null;

  const entryPrice = last.close;
  const atrBuffer = m15.atr * 0.35;
  const recent = m15Candles.slice(-10);
  const structuralExtreme =
    direction === "long" ? Math.min(...recent.map((c) => c.low)) : Math.max(...recent.map((c) => c.high));
  const stopLoss =
    direction === "long" ? structuralExtreme - atrBuffer : structuralExtreme + atrBuffer;

  const risk = Math.abs(entryPrice - stopLoss);
  if (risk <= 0) return null;

  const sign = direction === "long" ? 1 : -1;
  const tp1 = entryPrice + sign * risk;
  const tp2 = entryPrice + sign * risk * 2;
  const tp3 = entryPrice + sign * risk * 3;

  // Effective R:R is capped by the distance to the nearest macro barrier.
  const reachableAtr = Math.max(1, Math.min(3, h4.barrierDistanceAtr));
  const rrRatio = round(clamp(reachableAtr * (m15.atr / risk), 0.5, 3));

  const volatilityAtrRatio = h1.atr > 0 ? m15.atr / (h1.atr / 2) : 1;

  const confidence = scoreConfidence({
    alignment: graded.alignmentScore,
    rrRatio,
    symmetry: abc.symmetry,
    volatilityAtrRatio,
  });

  return {
    instrument: input.instrument,
    grade: graded.grade,
    direction,
    entryPrice: round(entryPrice, 5),
    stopLoss: round(stopLoss, 5),
    tp1: round(tp1, 5),
    tp2: round(tp2, 5),
    tp3: round(tp3, 5),
    atr: round(m15.atr, 5),
    rrRatio,
    patternSymmetry: round(abc.symmetry),
    confidence,
    h4Bias: describe(h4),
    h1Bias: describe(h1),
    m15Bias: describe(m15),
    qualitativeBreakdown: buildBreakdown({
      grade: graded.grade,
      direction,
      satisfied: graded.reasonsSatisfied,
      violated: graded.reasonsViolated,
      symmetry: abc.symmetry,
      alignment: graded.alignmentScore,
      rrRatio,
      atr: m15.atr,
    }),
  };
}

function describe(read: TimeframeRead): string {
  if (read.bias === "neutral") return "conflicting";
  return read.barrierDistanceAtr < 2.5 ? `${read.bias} / approaching macro resistance` : read.bias;
}

function round(v: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
