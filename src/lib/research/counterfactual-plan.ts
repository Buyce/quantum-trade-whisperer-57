/**
 * Prompt 7G — the frozen counterfactual R ladder.
 *
 * A setup rejected by `risk_too_wide`, `no_headroom` or `unreachable_r` already
 * has a genuinely derived entry, stop, risk and ATR. What it lacks is a target
 * ladder, because V1 stopped before building one. Those three gates ARE the
 * filters under test, so the research ladder must never consult them — it is a
 * fixed, unconditional 1R / 2R / 3R extension off the derived risk.
 *
 * No price is invented: every value is arithmetic on numbers that came from real
 * candles. Nothing here can be applied to a structurally-not-evaluable
 * evaluation — there is no entry or stop to work from.
 */
import type { Direction } from "@/lib/scanner/types";
import type { SetupEvaluation } from "@/lib/scanner/profile";

/**
 * Version of the ladder RULE. Bump it if the multiples ever change so old rows
 * can never be silently pooled with new ones.
 */
export const RESEARCH_PLAN_VERSION = 1;

/** Fixed research multiples. Deliberately independent of headroom and maxR. */
export const RESEARCH_TP_R: readonly [number, number, number] = [1, 2, 3];

export type PlanOrigin = "production" | "counterfactual";

export interface CounterfactualPlan {
  grade: string;
  tp1: number;
  tp2: number;
  tp3: number;
  tp1R: number;
  tp2R: number;
  tp3R: number;
  maxR: number;
  researchPlanVersion: number;
}

function round5(v: number): number {
  return Math.round(v * 1e5) / 1e5;
}

/**
 * Builds the COMMON research plan for an evaluation, or null when the
 * evaluation cannot support one. `null` is the safe answer everywhere.
 *
 * Prompt 7G red-team correction: the ladder is built for EVERY executable
 * evaluation — published as well as filter-rejected. Filter lift compares a
 * gate's pass arm with its fail arm, so both arms must be replayed under one
 * identical, filter-independent execution plan. Grouping a published production
 * ladder (headroom- and reachable-R-conditioned) against an unconditional 3R
 * ladder would measure the ladder, not the filter.
 */
export function buildCounterfactualPlan(e: SetupEvaluation): CounterfactualPlan | null {
  if (e.counterfactual !== "executable") return null;


  const entry = e.geometry.entryPrice;
  const stop = e.geometry.stopLoss;
  const risk = e.geometry.riskPrice;
  const direction = e.direction as Direction | null;
  if (entry === null || stop === null || risk === null || risk <= 0) return null;
  if (direction !== "long" && direction !== "short") return null;

  // The grade tier was already established by a gate that PASSED, so it is a
  // real measurement rather than a placeholder.
  const tier = e.features["gradedTier"];
  if (typeof tier !== "string" || !tier) return null;

  const sign = direction === "long" ? 1 : -1;
  const [r1, r2, r3] = RESEARCH_TP_R;
  return {
    grade: tier,
    tp1: round5(entry + sign * risk * r1),
    tp2: round5(entry + sign * risk * r2),
    tp3: round5(entry + sign * risk * r3),
    tp1R: r1,
    tp2R: r2,
    tp3R: r3,
    maxR: r3,
    researchPlanVersion: RESEARCH_PLAN_VERSION,
  };
}
