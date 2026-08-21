import { clamp, detectAbc } from "./indicators";
import { directionalHeadroomAtr, gradeSetup, readTimeframe, scoreConfluence } from "./grading";
import {
  CONFIDENCE_WEIGHTS,
  DEFAULT_SPREAD_FLOOR,
  DYNAMIC_ENTRY_ATR_FRACTION,
  MAX_RISK_ATR,
  MIN_DYNAMIC_RISK_ATR,
  MIN_REACHABLE_R,
  PILLAR_PASS_SCORE,
  RUNAWAY_SESSIONS,
  SLIPPAGE_TOLERANCE_R,
  TIGHT_SLIPPAGE_TOLERANCE_R,
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
          ? `B-Grade: H1 and M15 are aligned ${dirw}, but this tier does not require H4 agreement or clear H4 headroom — either may be absent.`
          : `C-Grade: M15 shows a localized ${dirw} break with no H1 confirmation. This tier is a directional M15 read, not a validated mean-reversion setup.`;

  const sat = args.satisfied.length
    ? `Rules satisfied: ${args.satisfied.join("; ")}.`
    : "Rules satisfied: none of the tier-A structural rules were met.";
  const vio = args.violated.length
    ? `Rules violated: ${args.violated.join("; ")}.`
    : "Rules violated: none.";

  const pillars = `Confluence pillars ${args.pillars.passed}/4 — ${args.pillars.notes.join("; ")}.`;

  const metrics = `Pattern symmetry ${args.symmetry.toFixed(1)}% (diagnostic only — it does not contribute to the confluence score), timeframe alignment ${args.alignment.toFixed(1)}%, planned R:R ${args.rrRatio.toFixed(2)} with a stop placed beyond the structural extreme plus a ${args.atr.toFixed(5)} ATR buffer.`;

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
  /**
   * Trading session at detection time (see `sessionOf` in the pipeline). Drives
   * the session-aware dynamic entry offset; omitted means structural entry only.
   */
  session?: string;
}

/**
 * Prompt 7 Stage 2 — gate labelling.
 *
 * V1 used to collapse six structurally different rejections into one `null`, so
 * the research engine could not tell "no ABC leg" from "risk too wide". The
 * evaluation is now explicit: every gate is recorded in evaluation order with a
 * pass / fail / not_evaluable outcome, and exactly one terminal stage is
 * reported. The geometry maths below is UNCHANGED — `buildTradeProfile()` is a
 * thin adapter over this function, so publication behaviour is identical.
 */
export type GateId =
  | "candles_present"
  | "m15_direction"
  | "grade"
  | "abc_structure"
  | "risk_defined"
  | "risk_ceiling"
  | "headroom"
  | "reachable_r";

export type GateOutcome = "pass" | "fail" | "not_evaluable";

export type EvaluationStage =
  | "published"
  | "no_candles"
  | "m15_neutral"
  | "no_grade"
  | "no_abc"
  | "risk_undefined"
  | "risk_too_wide"
  | "no_headroom"
  | "unreachable_r";

export interface GateResult {
  gate: GateId;
  outcome: GateOutcome;
  detail?: string;
}

/** Geometry that was actually derived. Never invented to fill a column. */
export interface PartialGeometry {
  entryPrice: number | null;
  stopLoss: number | null;
  riskPrice: number | null;
  structuralEntry: number | null;
  structureKey: string | null;
  atr: number | null;
}

/**
 * Prompt 7G — can this evaluation ever be forward-tested?
 *
 * `executable` means the geometry block genuinely ran: a real entry, stop,
 * positive risk and ATR were derived from candles, and only a FILTER rejected
 * the setup. `structurally_not_evaluable` means no plan exists at all (no
 * candles, no direction, no grade, no ABC leg, undefined risk) — nothing can be
 * forward-tested without inventing prices, so nothing ever is.
 */
export type CounterfactualClass = "executable" | "structurally_not_evaluable";

/** The only rejection stages that leave a complete, genuinely derived plan. */
export const COUNTERFACTUAL_STAGES: readonly EvaluationStage[] = [
  "risk_too_wide",
  "no_headroom",
  "unreachable_r",
];

export interface SetupEvaluation {
  /** Exactly one terminal stage per evaluation. */
  stage: EvaluationStage;
  /** Gates in evaluation order; everything after the terminal gate is `not_evaluable`. */
  gates: GateResult[];
  direction: Direction | null;
  /** Deterministic measurements behind the decision — reproducible from candles alone. */
  features: Record<string, number | string | boolean | null>;
  /** Derived geometry, as far as it got. `null` fields are genuinely undefined. */
  geometry: PartialGeometry;
  /** Whether a research plan can exist for this evaluation at all. */
  counterfactual: CounterfactualClass;
  /** Populated ONLY when every gate passed. Never a partial or fabricated plan. */
  proposedProfile: TradeProfile | null;
}

/** Classifies an evaluation without consulting the filters under test. */
export function classifyCounterfactual(
  stage: EvaluationStage,
  geometry: PartialGeometry,
  direction: Direction | null,
): CounterfactualClass {
  if (stage === "published") return "executable";
  if (!COUNTERFACTUAL_STAGES.includes(stage)) return "structurally_not_evaluable";
  const complete =
    direction !== null &&
    geometry.entryPrice !== null &&
    geometry.stopLoss !== null &&
    geometry.riskPrice !== null &&
    geometry.riskPrice > 0 &&
    geometry.atr !== null;
  return complete ? "executable" : "structurally_not_evaluable";
}

const GATE_ORDER: GateId[] = [
  "candles_present",
  "m15_direction",
  "grade",
  "abc_structure",
  "risk_defined",
  "risk_ceiling",
  "headroom",
  "reachable_r",
];

const EMPTY_GEOMETRY: PartialGeometry = {
  entryPrice: null,
  stopLoss: null,
  riskPrice: null,
  structuralEntry: null,
  structureKey: null,
  atr: null,
};

/** Records the failing gate and marks every later gate not_evaluable. */
function terminate(
  gates: GateResult[],
  failing: GateId,
  stage: EvaluationStage,
  detail: string,
): Pick<SetupEvaluation, "stage" | "gates"> {
  const done = [...gates, { gate: failing, outcome: "fail" as GateOutcome, detail }];
  const seen = new Set(done.map((g) => g.gate));
  for (const gate of GATE_ORDER) {
    if (!seen.has(gate)) done.push({ gate, outcome: "not_evaluable" });
  }
  return { stage, gates: done };
}

/**
 * Turns raw OHLCV candles into a Phase-2 Trade Profile, or null when the
 * market offers no qualifying setup (the No-Trade default).
 *
 * Adapter over `evaluateSetup()`: identical inputs produce identical outputs.
 */
export function buildTradeProfile(input: BuildProfileInput): TradeProfile | null {
  const evaluation = evaluateSetup(input);
  return evaluation.stage === "published" ? evaluation.proposedProfile : null;
}

export function evaluateSetup(input: BuildProfileInput): SetupEvaluation {
  const gates: GateResult[] = [];
  const h4 = readTimeframe("H4", input.candles.H4);
  const h1 = readTimeframe("H1", input.candles.H1);
  const m15 = readTimeframe("M15", input.candles.M15);

  const features: Record<string, number | string | boolean | null> = {
    instrument: input.instrument,
    session: input.session ?? null,
    h4Bias: h4.bias,
    h1Bias: h1.bias,
    m15Bias: m15.bias,
    h4Atr: round(h4.atr, 5),
    h1Atr: round(h1.atr, 5),
    m15Atr: round(m15.atr, 5),
    h4Candles: input.candles.H4.length,
    h1Candles: input.candles.H1.length,
    m15Candles: input.candles.M15.length,
  };

  const fail = (
    failing: GateId,
    stage: EvaluationStage,
    detail: string,
    direction: Direction | null = null,
    geometry: PartialGeometry = EMPTY_GEOMETRY,
  ): SetupEvaluation => ({
    ...terminate(gates, failing, stage, detail),
    direction,
    features,
    geometry,
    counterfactual: classifyCounterfactual(stage, geometry, direction),
    proposedProfile: null,
  });

  if (!input.candles.M15.length) {
    return fail("candles_present", "no_candles", "M15 candle series is empty");
  }
  gates.push({ gate: "candles_present", outcome: "pass" });

  if (m15.bias === "neutral") {
    return fail("m15_direction", "m15_neutral", "M15 bias is neutral — no directional read");
  }
  gates.push({ gate: "m15_direction", outcome: "pass" });
  const direction: Direction = m15.bias === "bullish" ? "long" : "short";
  features["direction"] = direction;

  // Headroom is measured in the direction this trade actually travels, not from
  // H4's own bias, so an aligned continuation is no longer vetoed for sitting at
  // the high of its own trend.
  const headroomAtr = directionalHeadroomAtr(direction, input.candles.H4, h4);
  features["headroomAtr"] = round(headroomAtr, 3);

  const graded = gradeSetup(h4, h1, m15, headroomAtr);
  features["alignmentScore"] = round(graded.alignmentScore, 2);
  features["gradedTier"] = graded.grade ?? null;
  if (!graded.grade) {
    return fail("grade", "no_grade", "No grading tier was satisfied", direction);
  }
  gates.push({ gate: "grade", outcome: "pass" });

  const abc = detectAbc(input.candles.M15, direction);
  if (!abc) {
    return fail("abc_structure", "no_abc", "No ABC retracement structure detected", direction);
  }
  gates.push({ gate: "abc_structure", outcome: "pass" });
  features["patternSymmetry"] = round(abc.symmetry, 2);
  features["pointC"] = round(abc.c, 5);

  const m15Candles = input.candles.M15;
  const last = m15Candles[m15Candles.length - 1] as Candle | undefined;
  if (!last) {
    return fail("candles_present", "no_candles", "M15 series has no last candle", direction);
  }

  // 1.2x M15 ATR beyond the structural extreme, floored by 0.5x H1 ATR and by
  // a realistic per-instrument spread allowance.
  const spreadFloor = SPREAD_FLOOR[input.instrument] ?? DEFAULT_SPREAD_FLOOR;
  const buffer = Math.max(
    m15.atr * STOP_M15_ATR_MULTIPLIER,
    h1.atr * STOP_H1_ATR_FLOOR,
    spreadFloor,
  );
  const recent = m15Candles.slice(-10);
  const structuralExtreme =
    direction === "long"
      ? Math.min(...recent.map((c) => c.low))
      : Math.max(...recent.map((c) => c.high));
  const stopLoss = direction === "long" ? structuralExtreme - buffer : structuralExtreme + buffer;

  const sign = direction === "long" ? 1 : -1;
  // The barrier that matters is the one this TRADE runs into, not the one H4's
  // own bias happens to point at. Reading barrierPrice here made every short
  // unpublishable whenever H4 was neutral or bullish (barrier above entry).
  const h4Barrier = direction === "long" ? h4.rangeHigh : h4.rangeLow;

  features["stopBuffer"] = round(buffer, 5);
  features["structuralExtreme"] = round(structuralExtreme, 5);
  features["stopLoss"] = round(stopLoss, 5);
  features["h4Barrier"] = round(h4Barrier, 5);
  features["lastClose"] = round(last.close, 5);

  /**
   * Risk / reachability validation for a candidate entry. The guards are the
   * unchanged V1 guards; only the failure REASON is new, so the research engine
   * can distinguish over-wide risk from an unreachable extension.
   */
  type EvalFail = {
    ok: false;
    reason: Extract<
      EvaluationStage,
      "risk_undefined" | "risk_too_wide" | "no_headroom" | "unreachable_r"
    >;
    detail: string;
  };
  type EvalOk = { ok: true; risk: number; maxR: number };
  const evaluate = (candidate: number): EvalOk | EvalFail => {
    const r = Math.abs(candidate - stopLoss);
    if (r <= 0)
      return { ok: false, reason: "risk_undefined", detail: "entry equals the stop: risk is zero" };
    if (m15.atr > 0 && r > m15.atr * MAX_RISK_ATR)
      return {
        ok: false,
        reason: "risk_too_wide",
        detail: `risk ${round(r / m15.atr, 2)} ATR exceeds the ${MAX_RISK_ATR} ATR ceiling`,
      };
    const room = (h4Barrier - candidate) * sign;
    if (room <= 0)
      return {
        ok: false,
        reason: "no_headroom",
        detail: "entry is already at or beyond the H4 barrier",
      };
    const mr = round(room / r);
    if (mr < MIN_REACHABLE_R)
      return {
        ok: false,
        reason: "unreachable_r",
        detail: `reachable ${mr}R is below the ${MIN_REACHABLE_R}R floor`,
      };
    return { ok: true, risk: r, maxR: mr };
  };

  const gateOfReason: Record<EvalFail["reason"], GateId> = {
    risk_undefined: "risk_defined",
    risk_too_wide: "risk_ceiling",
    no_headroom: "headroom",
    unreachable_r: "reachable_r",
  };

  // Entry defaults to the Point C structural level, not "wherever the last
  // candle closed". That is what makes this a genuine pending limit order and
  // keeps risk stable across consecutive scans of the same leg.
  const structuralEntry = abc.c;

  // Session-aware dynamic entry offset. In the London/New York overlap the
  // momentum regime rarely retests a deep Point C (87% of overlap setups never
  // filled), so the limit is shifted toward the breakout close by a fraction of
  // ATR. Every guard below falls back to the structural entry, so the feature
  // can never lose a setup that publishes today.
  let dynamicEntry = false;
  let entryPrice = structuralEntry;
  if (input.session && RUNAWAY_SESSIONS.includes(input.session) && m15.atr > 0) {
    let candidate = last.close - sign * DYNAMIC_ENTRY_ATR_FRACTION * m15.atr;

    // 1. Never a price worse than the current market — a limit must sit behind it.
    const marketLimit = last.close - sign * spreadFloor;
    const notWorseThanMarket =
      direction === "long" ? candidate <= marketLimit : candidate >= marketLimit;

    // 2. Never further from the market than the structural entry.
    candidate =
      direction === "long"
        ? Math.max(candidate, structuralEntry)
        : Math.min(candidate, structuralEntry);

    // 3. Never crosses — or hugs — the stop.
    const onCorrectSideOfStop = direction === "long" ? candidate > stopLoss : candidate < stopLoss;
    const clearsStopFloor = Math.abs(candidate - stopLoss) >= MIN_DYNAMIC_RISK_ATR * m15.atr;

    // 4. Risk ceiling and reachable-R floor, re-derived on the candidate.
    if (notWorseThanMarket && onCorrectSideOfStop && clearsStopFloor && evaluate(candidate).ok) {
      entryPrice = candidate;
      dynamicEntry = candidate !== structuralEntry;
    }
  }

  const geometry: PartialGeometry = {
    entryPrice: round(entryPrice, 5),
    stopLoss: round(stopLoss, 5),
    riskPrice: round(Math.abs(entryPrice - stopLoss), 5),
    structuralEntry: round(structuralEntry, 5),
    structureKey: structureKeyOf({
      instrument: input.instrument,
      direction,
      aTime: abc.aTime,
      bTime: abc.bTime,
      stopLoss,
    }),
    atr: round(m15.atr, 5),
  };
  features["dynamicEntry"] = dynamicEntry;
  features["entryPrice"] = geometry.entryPrice;
  features["riskPrice"] = geometry.riskPrice;

  const validated = evaluate(entryPrice);
  if (!validated.ok) {
    return fail(
      gateOfReason[validated.reason],
      validated.reason,
      validated.detail,
      direction,
      geometry,
    );
  }
  gates.push({ gate: "risk_defined", outcome: "pass" });
  gates.push({ gate: "risk_ceiling", outcome: "pass" });
  gates.push({ gate: "headroom", outcome: "pass" });
  gates.push({ gate: "reachable_r", outcome: "pass" });
  const { risk, maxR } = validated;

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

  // Slippage ceiling. Beyond this price the payoff the grade was based on is
  // materially broken, so the setup becomes "limit order on the retest only".
  // Thin extensions get the tighter tolerance: a marginal setup must not be
  // slipped into negative expectancy.
  const tolerance = maxR < 1.5 ? TIGHT_SLIPPAGE_TOLERANCE_R : SLIPPAGE_TOLERANCE_R;
  const maxAcceptableEntry = round(entryPrice + sign * risk * tolerance, 5);

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

  // One sentence so the card explains why the limit is not sitting at Point C.
  const dynamicEntryNote = dynamicEntry
    ? ` Entry is dynamically offset: the ${input.session} momentum regime rarely retests the structural Point C (${round(structuralEntry, 5)}), so the limit sits ${DYNAMIC_ENTRY_ATR_FRACTION} ATR behind the detection close instead, with risk re-validated against the unchanged structural stop.`
    : "";

  const confidence = scoreConfidence({ pillars, rrRatio, symmetry: abc.symmetry });

  const satisfied = [...graded.reasonsSatisfied];
  const violated = [...graded.reasonsViolated];
  if (pillars.orderBlock >= PILLAR_PASS_SCORE)
    satisfied.push("Point C is retesting an institutional order block");
  else violated.push("Point C is not inside an unmitigated H1/H4 order block");
  if (pillars.momentum >= PILLAR_PASS_SCORE)
    satisfied.push("M15 momentum shows exhaustion at Point C");
  else violated.push("M15 momentum shows no exhaustion or divergence at Point C");
  if (pillars.volatilityExpansion >= PILLAR_PASS_SCORE)
    satisfied.push("M15 volatility is expanding above its 20-period ATR average");
  else violated.push("M15 volatility is below its 20-period ATR average");

  features["grade"] = grade;
  features["maxR"] = maxR;
  features["rrRatio"] = rrRatio;
  features["confidenceScore"] = confidence.score;
  features["pillarsPassed"] = pillars.passed;

  const proposedProfile: TradeProfile = {
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
    maxAcceptableEntry,
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
    h4Bias: describe(h4, headroomAtr),
    h1Bias: describe(h1),
    m15Bias: describe(m15),
    qualitativeBreakdown:
      buildBreakdown({
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
      }) + dynamicEntryNote,
  };

  return {
    stage: "published",
    gates,
    direction,
    features,
    geometry,
    counterfactual: "executable",
    proposedProfile,
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
  return [args.instrument, args.direction, args.aTime, args.bTime, args.stopLoss.toFixed(5)].join(
    "|",
  );
}

function describe(read: TimeframeRead, headroomAtr?: number): string {
  if (read.bias === "neutral") return "conflicting";
  const room = headroomAtr ?? read.barrierDistanceAtr;
  return room < 2.5 ? `${read.bias} / approaching macro resistance` : read.bias;
}

function round(v: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
