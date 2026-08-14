import { clamp, detectAbc } from "./indicators";
import { gradeSetup, readTimeframe, scoreConfluence } from "./grading";
import {
  CONFIDENCE_WEIGHTS,
  DEFAULT_SPREAD_FLOOR,
  MAX_RISK_ATR,
  MIN_REACHABLE_R,
  PILLAR_PASS_SCORE,
  SPREAD_FLOOR,
  STOP_H1_ATR_FLOOR,
  STOP_M15_ATR_MULTIPLIER,
  type Candle,
  type ConfidenceBreakdown,
  type Direction,
  type Grade,
  type PillarScores,
  type TradeProfile,
  type TimeframeRead,
} from "./types";

/**
 * Confidence is the weighted confluence of the four pillars, then capped by the
 * planned payoff: a flawless structure with a 1:0.5 payoff cannot score high.
 */
export function scoreConfidence(input: {
  pillars: PillarScores;
  rrRatio: number;
  symmetry: number;
}): ConfidenceBreakdown {
  const p = input.pillars;
  const rr = clamp((input.rrRatio / 3) * 100, 0, 100);
  const weighted =
    p.trend * CONFIDENCE_WEIGHTS.trend +
    p.orderBlock * CONFIDENCE_WEIGHTS.orderBlock +
    p.momentum * CONFIDENCE_WEIGHTS.momentum +
    p.volatilityExpansion * CONFIDENCE_WEIGHTS.volatilityExpansion;
  // R:R multiplier cap — 1:2 or better is neutral, thinner payoffs discount.
  const rrMultiplier = clamp(input.rrRatio / 2, 0.7, 1);

  return {
    alignment: round(p.trend),
    rr: round(rr),
    symmetry: round(clamp(input.symmetry, 0, 100)),
    volatility: round(p.volatilityExpansion),
    score: round(clamp(weighted * rrMultiplier, 0, 100)),
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
  pillars: PillarScores;
  capped?: boolean;
  maxR?: number;
}): string {
  const dirw = args.direction === "long" ? "bullish" : "bearish";
  const head =
    args.grade === "A+"
      ? `A+ Grade: institutional confluence — a full ${dirw} continuation structure with all four confluence pillars satisfied.`
      : args.grade === "A"
        ? `A-Grade: full ${dirw} continuation structure. Every tier rule is satisfied.`
        : args.grade === "B"
          ? `B-Grade: primary ${dirw} trend alignment on H1 and M15, but H4 context caps the extension.`
          : `C-Grade: aggressive localized M15 ${dirw} structural break with conflicting higher timeframes — mean-reversion only.`;

  const sat = args.satisfied.length
    ? `Rules satisfied: ${args.satisfied.join("; ")}.`
    : "Rules satisfied: none of the tier-A structural rules were met.";
  const vio = args.violated.length ? `Rules violated: ${args.violated.join("; ")}.` : "Rules violated: none.";

  const pillars = `Confluence pillars ${args.pillars.passed}/4 — ${args.pillars.notes.join("; ")}.`;

  const metrics = `Pattern symmetry ${args.symmetry.toFixed(1)}%, timeframe alignment ${args.alignment.toFixed(1)}%, planned R:R ${args.rrRatio.toFixed(2)} with a stop placed beyond the structural extreme plus a ${args.atr.toFixed(5)} ATR buffer.`;

  const advice =
    args.grade === "A+"
      ? "Highest-conviction tier: full 1:3 extension with trailing management is justified."
      : args.grade === "A"
        ? "Full 1:3 extension is on the table."
        : args.grade === "B"
          ? "Manage to 1:2 unless H4 clears its barrier."
          : "Default philosophy is No Trade unless the volatility context is exceptional.";

  const cap =
    args.capped && typeof args.maxR === "number"
      ? ` Extension is capped at ${args.maxR.toFixed(2)}R by the nearest H4 structural barrier — targets are scaled to what the structure can actually reach.`
      : "";

  return `${head} ${sat} ${vio} ${pillars} ${metrics} ${advice}${cap}`;
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

  // Entry is the Point C structural level, not "wherever the last candle
  // closed". That is what makes this a genuine pending limit order and keeps
  // risk stable across consecutive scans of the same leg.
  const entryPrice = abc.c;

  // 1.2x M15 ATR beyond the structural extreme, floored by 0.5x H1 ATR and by
  // a realistic per-instrument spread allowance.
  const buffer = Math.max(
    m15.atr * STOP_M15_ATR_MULTIPLIER,
    h1.atr * STOP_H1_ATR_FLOOR,
    SPREAD_FLOOR[input.instrument] ?? DEFAULT_SPREAD_FLOOR,
  );
  const recent = m15Candles.slice(-10);
  const structuralExtreme =
    direction === "long" ? Math.min(...recent.map((c) => c.low)) : Math.max(...recent.map((c) => c.high));
  const stopLoss = direction === "long" ? structuralExtreme - buffer : structuralExtreme + buffer;

  const risk = Math.abs(entryPrice - stopLoss);
  if (risk <= 0) return null;
  // Over-wide risk is No-Trade, not a 0.5 R:R publication.
  if (m15.atr > 0 && risk > m15.atr * MAX_RISK_ATR) return null;

  const sign = direction === "long" ? 1 : -1;

  // Real reachable extension: distance from entry to the nearest H4 structural
  // barrier, expressed in R. No unit mixing, no invented multiples.
  const barrierRoom = (h4.barrierPrice - entryPrice) * sign;
  if (barrierRoom <= 0) return null;
  const maxR = round(barrierRoom / risk);
  if (maxR < MIN_REACHABLE_R) return null;

  const capped = maxR < 3;
  const multiples: [number, number, number | null] =
    maxR >= 3
      ? [1, 2, 3]
      : maxR >= 1.5
        ? [round(maxR * 0.5), round(maxR * 0.75), round(maxR)]
        : [round(maxR * 0.6), round(maxR), null];

  const [tp1R, tp2R, tp3R] = multiples;
  const target = (r: number) => round(entryPrice + sign * risk * r, 5);
  const tp1 = target(tp1R);
  const tp2 = target(tp2R);
  const tp3 = tp3R === null ? null : target(tp3R);

  // R:R headline is exactly the final target's R — the card and the number can
  // no longer disagree.
  const rrRatio = round(tp3R ?? tp2R);

  const pillars = scoreConfluence({
    direction,
    pointC: abc.c,
    alignmentScore: graded.alignmentScore,
    allAligned: h4.bias !== "neutral" && h4.bias === h1.bias && h1.bias === m15.bias,
    h4Candles: input.candles.H4,
    h1Candles: input.candles.H1,
    m15Candles,
    m15Atr: m15.atr,
  });

  // A+ is a strict superset of A: the same structure plus all four pillars.
  const grade: Grade = graded.grade === "A" && pillars.passed === 4 ? "A+" : graded.grade;

  const confidence = scoreConfidence({ pillars, rrRatio, symmetry: abc.symmetry });

  const satisfied = [...graded.reasonsSatisfied];
  const violated = [...graded.reasonsViolated];
  if (pillars.orderBlock >= PILLAR_PASS_SCORE) satisfied.push("Point C is retesting an institutional order block");
  else violated.push("Point C is not inside an unmitigated H1/H4 order block");
  if (pillars.momentum >= PILLAR_PASS_SCORE) satisfied.push("M15 momentum shows exhaustion at Point C");
  else violated.push("M15 momentum shows no exhaustion or divergence at Point C");
  if (pillars.volatilityExpansion >= PILLAR_PASS_SCORE) satisfied.push("M15 volatility is expanding above its 20-period ATR average");
  else violated.push("M15 volatility is below its 20-period ATR average");

  return {
    instrument: input.instrument,
    grade,
    direction,
    entryPrice: round(entryPrice, 5),
    stopLoss: round(stopLoss, 5),
    tp1,
    tp2,
    tp3,
    tp1R,
    tp2R,
    tp3R,
    maxR,
    capped,
    structureKey: structureKeyOf({
      instrument: input.instrument,
      direction,
      aTime: abc.aTime,
      bTime: abc.bTime,
      stopLoss,
    }),
    atr: round(m15.atr, 5),
    rrRatio,
    patternSymmetry: round(abc.symmetry),
    confidence,
    pillars,
    h4Bias: describe(h4),
    h1Bias: describe(h1),
    m15Bias: describe(m15),
    qualitativeBreakdown: buildBreakdown({
      grade,
      direction,
      satisfied,
      violated,
      symmetry: abc.symmetry,
      alignment: graded.alignmentScore,
      rrRatio,
      atr: m15.atr,
      pillars,
      capped,
      maxR,
    }),
  };
}

/**
 * Stable identity of one ABC leg: instrument, direction, the swing A/B candle
 * timestamps and the structural stop anchor. Two scans of the same lingering
 * structure produce the same key; a genuinely new leg produces a new one.
 */
export function structureKeyOf(args: {
  instrument: string;
  direction: Direction;
  aTime: string;
  bTime: string;
  stopLoss: number;
}): string {
  return [
    args.instrument,
    args.direction,
    args.aTime,
    args.bTime,
    args.stopLoss.toFixed(5),
  ].join("|");
}


function describe(read: TimeframeRead): string {
  if (read.bias === "neutral") return "conflicting";
  return read.barrierDistanceAtr < 2.5 ? `${read.bias} / approaching macro resistance` : read.bias;
}

function round(v: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
