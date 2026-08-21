/**
 * V3 research trade profile (research model version 3).
 *
 * Inherits V2's corrected structure primitives verbatim — canonical Point C,
 * the single H4 barrier, and the native-ATR pillars — and applies the three
 * geometry corrections that V1 and V2 both get wrong:
 *
 *   1. Stop anchor  -> ./stop      (retracement leg B+1..C, not the last 10 bars)
 *   2. Entry        -> structural only, no session offset
 *   3. Slippage     -> ./slippage  (target-preserving; k <= m => limit-only)
 *
 * V3 never publishes and never touches V1 or V2 state. The return value is a
 * research observation: a decision, plus a profile when the decision is
 * `candidate`.
 */
import { readTimeframe } from "../grading";
import { MAX_RISK_ATR, MIN_REACHABLE_R, type Candle, type Direction } from "../types";
import { structureKeyOf } from "../profile";
import { canonicalBarrier } from "../v2/barrier";
import { gradeSetupV2, type GradeFamilyV2 } from "../v2/grading.v2";
import { scoreConfluenceV2 } from "../v2/pillars";
import { detectAbcV2 } from "../v2/pointc";
import { MODEL_V3_VERSION } from "./manifest";
import { maxAcceptableEntryV3 } from "./slippage";
import { legScopedStop } from "./stop";

export type V3Decision = "candidate" | "no_trade";

export interface V3Profile {
  instrument: string;
  direction: Direction;
  family: GradeFamilyV2;
  grade: "A+" | "A" | "B" | "C";
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number | null;
  tp1R: number;
  tp2R: number;
  tp3R: number | null;
  maxR: number;
  rrRatio: number;
  maxAcceptableEntry: number;
  /** True when the locked V3 slippage rule allows no slippage at all. */
  limitOnly: boolean;
  /** The m the ceiling was derived against — 2.0 with TP3, 1.0 on thin. */
  slippageMinRatio: number;
  capped: boolean;
  atr: number;
  retracement: number;
  /** Diagnostic only — never contributes to any score. */
  patternSymmetry: number;
  headroomAtr: number;
  barrierSource: "structure" | "open_space_extension";
  structureKey: string;
  /** Provenance stamped onto the shadow row. */
  entrySource: "structural";
  stopAnchor: "retracement_leg";
  /** Price the leg-scoped stop was anchored on, before the buffer. */
  stopAnchorPrice: number;
  pillarsPassed: number;
  pTrend: number;
  pOrderBlock: number;
  pMomentum: number;
  pVolatilityExpansion: number;
  reasons: string[];
}

export interface V3Evaluation {
  modelVersion: typeof MODEL_V3_VERSION;
  decision: V3Decision;
  /** Set for a mean-reversion read, which is recorded but never enrolled. */
  observationOnly: boolean;
  reason: string;
  profile: V3Profile | null;
}

function noTrade(reason: string): V3Evaluation {
  return {
    modelVersion: MODEL_V3_VERSION,
    decision: "no_trade",
    observationOnly: false,
    reason,
    profile: null,
  };
}

export function buildTradeProfileV3(input: {
  instrument: string;
  candles: Record<"H4" | "H1" | "M15", Candle[]>;
}): V3Evaluation {
  const h4 = readTimeframe("H4", input.candles.H4);
  const h1 = readTimeframe("H1", input.candles.H1);
  const m15 = readTimeframe("M15", input.candles.M15);

  if (m15.bias === "neutral") return noTrade("M15 has no directional structure");
  const direction: Direction = m15.bias === "bullish" ? "long" : "short";

  const m15Candles = input.candles.M15;
  const last = m15Candles[m15Candles.length - 1];
  const lastH4 = input.candles.H4[input.candles.H4.length - 1];
  if (!last || !lastH4) return noTrade("Incomplete candle snapshot");
  if (!(m15.atr > 0) || !(h4.atr > 0)) return noTrade("Volatility not measurable");

  const abc = detectAbcV2(m15Candles, direction);
  if (!abc) return noTrade("No canonical ABC continuation inside the retracement band");

  // Correction 1: the stop is anchored on the retracement leg only.
  const stop = legScopedStop({
    instrument: input.instrument,
    direction,
    candles: m15Candles,
    bIndex: abc.bIndex,
    cIndex: abc.cIndex,
    m15Atr: m15.atr,
    h1Atr: h1.atr,
  });
  if (!stop) return noTrade("Retracement leg does not yield a stop anchor");
  const stopLoss = stop.stopLoss;

  // Correction 2: structural entry only. V3 never offsets off Point C.
  const entryPrice = abc.c;
  const sign = direction === "long" ? 1 : -1;
  const risk = Math.abs(entryPrice - stopLoss);
  if (!(risk > 0)) return noTrade("Entry sits on the structural stop");
  const onCorrectSide = direction === "long" ? entryPrice > stopLoss : entryPrice < stopLoss;
  if (!onCorrectSide) return noTrade("Leg-scoped stop sits on the wrong side of the entry");
  if (risk > m15.atr * MAX_RISK_ATR) return noTrade("Risk exceeds the ATR ceiling");

  const barrier = canonicalBarrier({
    direction,
    h4Candles: input.candles.H4,
    h4Atr: h4.atr,
    reference: lastH4.close,
    anchor: entryPrice,
  });
  if (!barrier) return noTrade("Canonical H4 barrier not measurable");

  const room = (barrier.price - entryPrice) * sign;
  if (room <= 0) return noTrade("Canonical H4 barrier sits behind the entry");
  const maxR = round(room / risk);
  if (maxR < MIN_REACHABLE_R) return noTrade("Extension below the minimum reachable R");

  const pillars = scoreConfluenceV2({
    direction,
    pointC: abc.c,
    alignmentScore: alignmentScoreOf(h4.bias, h1.bias, m15.bias, h4.atPointC),
    allAligned: h4.bias !== "neutral" && h4.bias === h1.bias && h1.bias === m15.bias,
    h4Candles: input.candles.H4,
    h1Candles: input.candles.H1,
    m15Candles,
    m15Atr: m15.atr,
  });

  const graded = gradeSetupV2({
    h4Bias: h4.bias,
    h1Bias: h1.bias,
    m15Bias: m15.bias,
    headroomAtr: barrier.headroomAtr,
    inRetracementBand: true,
    pillars,
  });
  if (!graded.grade || !graded.family) return noTrade("No V3 grade family");

  // Target ladder: V1 mechanics, unchanged.
  const capped = maxR < 3;
  const multiples: [number, number, number | null] =
    maxR >= 3
      ? [1, 2, 3]
      : maxR >= 1.5
        ? [round(maxR * 0.5), round(maxR * 0.75), round(maxR)]
        : [round(maxR * 0.6), round(maxR), null];
  const [tp1R, tp2R, tp3R] = multiples;
  const target = (r: number) => round(entryPrice + sign * risk * r, 5);
  const rrRatio = round(tp3R ?? tp2R);

  // Correction 3: the ceiling preserves the payoff the grade was based on.
  const ceiling = maxAcceptableEntryV3({ entryPrice, stopLoss, maxR, direction });

  const profile: V3Profile = {
    instrument: input.instrument,
    direction,
    family: graded.family,
    grade: graded.grade,
    entryPrice: round(entryPrice, 5),
    stopLoss: round(stopLoss, 5),
    tp1: target(tp1R),
    tp2: target(tp2R),
    tp3: tp3R === null ? null : target(tp3R),
    tp1R,
    tp2R,
    tp3R,
    maxR,
    rrRatio,
    maxAcceptableEntry: round(ceiling.price, 5),
    limitOnly: ceiling.limitOnly,
    slippageMinRatio: ceiling.minRatio,
    capped,
    atr: round(m15.atr, 5),
    retracement: round(abc.retracement, 4),
    patternSymmetry: round(abc.symmetry),
    headroomAtr: Number.isFinite(barrier.headroomAtr) ? round(barrier.headroomAtr) : 0,
    barrierSource: barrier.source,
    structureKey: structureKeyOf({
      instrument: input.instrument,
      direction,
      aTime: abc.aTime,
      bTime: abc.bTime,
      stopLoss,
    }),
    entrySource: "structural",
    stopAnchor: "retracement_leg",
    stopAnchorPrice: round(stop.anchor, 5),
    pillarsPassed: pillars.passed,
    pTrend: pillars.trend,
    pOrderBlock: pillars.orderBlock,
    pMomentum: pillars.momentum,
    pVolatilityExpansion: pillars.volatilityExpansion,
    reasons: graded.reasons,
  };

  return {
    modelVersion: MODEL_V3_VERSION,
    decision: "candidate",
    observationOnly: graded.family === "mean_reversion",
    reason:
      graded.family === "mean_reversion"
        ? "Mean-reversion candidate — recorded as an observation only"
        : `Continuation candidate graded ${graded.grade}`,
    profile,
  };
}

/** Same alignment scale V1/V2 use, so pillar 1 stays comparable across models. */
function alignmentScoreOf(
  h4Bias: string,
  h1Bias: string,
  m15Bias: string,
  h4AtPointC: boolean,
): number {
  const agreeing = [h4Bias, h1Bias, m15Bias].filter((b) => b === m15Bias && b !== "neutral").length;
  return agreeing === 3 ? Math.min(100, 92 + (h4AtPointC ? 6 : 0)) : agreeing === 2 ? 74 : 45;
}

function round(v: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
