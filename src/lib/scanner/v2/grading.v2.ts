/**
 * V2 grade truth table (research model version 2).
 *
 * V1's labels are not honest: `B` is reached by the SAME `h1m15Aligned` branch
 * whether or not H4 agrees and whether or not headroom is exhausted, and `C` is
 * "M15 has any bias at all" rather than a mean-reversion setup. V2 splits the
 * two families explicitly and never lets a mean-reversion read wear a
 * continuation grade.
 *
 * Continuation family (H1 and M15 aligned):
 *   A+  all three timeframes aligned, Point C inside the retracement band,
 *       headroom >= MIN_HEADROOM_ATR, and all four pillars passed.
 *   A   as A+ without the four-pillar requirement.
 *   B   H1 + M15 aligned, but H4 disagrees OR headroom is exhausted.
 *
 * Mean-reversion family (M15 opposes H1): graded `C` and, by policy, research
 * observation only — never published and never shadow-enrolled.
 */
import { MIN_HEADROOM_ATR } from "../grading";
import type { Bias, Grade, PillarScores } from "../types";

export type GradeFamilyV2 = "continuation" | "mean_reversion";

export interface GradeResultV2 {
  family: GradeFamilyV2 | null;
  grade: Grade | null;
  reasons: string[];
}

export function gradeSetupV2(args: {
  h4Bias: Bias;
  h1Bias: Bias;
  m15Bias: Bias;
  headroomAtr: number;
  inRetracementBand: boolean;
  pillars: PillarScores;
}): GradeResultV2 {
  const { h4Bias, h1Bias, m15Bias, headroomAtr, inRetracementBand, pillars } = args;
  const reasons: string[] = [];

  if (m15Bias === "neutral") {
    return { family: null, grade: null, reasons: ["M15 has no directional structure"] };
  }

  const h1m15Aligned = h1Bias !== "neutral" && h1Bias === m15Bias;
  const allAligned = h4Bias !== "neutral" && h4Bias === h1Bias && h1Bias === m15Bias;
  const roomOk = headroomAtr >= MIN_HEADROOM_ATR;

  if (!h1m15Aligned) {
    reasons.push(
      h1Bias === "neutral"
        ? "H1 has no directional structure, so M15 is not a continuation"
        : "M15 opposes the H1 trend — mean-reversion family",
    );
    return { family: "mean_reversion", grade: "C", reasons };
  }

  reasons.push("H1 and M15 agree — continuation family");
  if (allAligned) reasons.push("H4 agrees with H1 and M15");
  else reasons.push("H4 does not agree with H1 and M15");
  reasons.push(
    roomOk
      ? `Headroom ${headroomAtr.toFixed(1)} ATR to the canonical H4 barrier`
      : `Headroom only ${headroomAtr.toFixed(1)} ATR to the canonical H4 barrier`,
  );
  reasons.push(
    inRetracementBand
      ? "Point C sits inside the canonical retracement band"
      : "Point C is outside the canonical retracement band",
  );

  if (allAligned && roomOk && inRetracementBand) {
    return {
      family: "continuation",
      grade: pillars.passed === 4 ? "A+" : "A",
      reasons,
    };
  }
  return { family: "continuation", grade: "B", reasons };
}
