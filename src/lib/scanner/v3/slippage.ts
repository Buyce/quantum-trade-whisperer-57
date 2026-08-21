/**
 * V3 target-preserving slippage ceiling (research model version 3).
 *
 * V1/V2 publish a fixed tolerance (0.15R, or 0.10R on thin extensions) measured
 * on the ORIGINAL risk. Because the final target is fixed in price, spending
 * that tolerance both shrinks the numerator and grows the denominator: with
 * E=1.1000, S=1.0980, k=3 the ceiling 1.10030 leaves a realised ratio of 2.478,
 * not 3. That is a real haircut, and V1's own comment claimed 2.55.
 *
 * V3 keeps the SAME ceiling formula but derives the allowance from the payoff it
 * is willing to preserve. Given
 *
 *   r = |E - S|                (original risk in price)
 *   k = maxR                   (reachable R at the canonical barrier)
 *   m                          (minimum acceptable ratio AFTER slippage)
 *   t                          (hard tolerance cap, in R of the original risk)
 *
 * the target price is fixed at T = E + sign*r*k, and for a filled price
 * E + sign*d the realised ratio is (r*k - d) / (r + d). Requiring that to stay
 * at or above m gives
 *
 *   d <= r * (k - m) / (1 + m)
 *
 * so the allowance is d = min(r * (k - m) / (1 + m), r * t), and whenever
 * k <= m the allowance is exactly 0: the setup becomes limit-only, no slippage
 * is tolerated at all. Non-finite or non-positive inputs fail closed at d = 0.
 *
 * These parameters are frozen in ../v3/manifest.ts. Nothing in this module is
 * reachable from the V1 or V2 profile builders.
 */

/** Minimum post-slippage ratio for a full three-target ladder (TP3 present). */
export const V3_MIN_RATIO_FULL = 2.0;
/** Minimum post-slippage ratio for a thin extension (TP3 null). */
export const V3_MIN_RATIO_THIN = 1.0;
/** Hard cap on the allowance, expressed in R of the ORIGINAL risk. */
export const V3_SLIPPAGE_CAP_R = 0.15;

export const V3_SLIPPAGE_PARAMS = {
  minRatioFull: V3_MIN_RATIO_FULL,
  minRatioThin: V3_MIN_RATIO_THIN,
  capR: V3_SLIPPAGE_CAP_R,
  formula: "d = min(r*(k-m)/(1+m), r*t); k <= m => d = 0",
  targetsPreserved: true,
} as const;

/** The m that applies to a given reachable R (the ladder decides TP3). */
export function minRatioForMaxR(maxR: number): number {
  return maxR < 1.5 ? V3_MIN_RATIO_THIN : V3_MIN_RATIO_FULL;
}

/**
 * Slippage allowance in PRICE units. Always >= 0; exactly 0 means limit-only.
 */
export function slippageAllowance(args: {
  risk: number;
  maxR: number;
  minRatio: number;
  capR?: number;
}): number {
  const { risk, maxR, minRatio } = args;
  const capR = args.capR ?? V3_SLIPPAGE_CAP_R;
  if (![risk, maxR, minRatio, capR].every((n) => Number.isFinite(n))) return 0;
  if (!(risk > 0) || !(capR > 0)) return 0;
  if (maxR <= minRatio) return 0;
  const structural = (risk * (maxR - minRatio)) / (1 + minRatio);
  return Math.max(0, Math.min(structural, risk * capR));
}

/**
 * Maximum acceptable fill price. Equals the entry exactly when the allowance is
 * zero, which the card must read as "limit order on the retest only".
 */
export function maxAcceptableEntryV3(args: {
  entryPrice: number;
  stopLoss: number;
  maxR: number;
  direction: "long" | "short";
  capR?: number;
}): { price: number; allowance: number; minRatio: number; limitOnly: boolean } {
  const risk = Math.abs(args.entryPrice - args.stopLoss);
  const minRatio = minRatioForMaxR(args.maxR);
  const allowance = slippageAllowance({
    risk,
    maxR: args.maxR,
    minRatio,
    ...(args.capR === undefined ? {} : { capR: args.capR }),
  });
  const sign = args.direction === "long" ? 1 : -1;
  return {
    price: args.entryPrice + sign * allowance,
    allowance,
    minRatio,
    limitOnly: allowance === 0,
  };
}
