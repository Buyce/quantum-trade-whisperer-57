/**
 * V2 volatility-expansion transform (research model version 2).
 *
 * V1 uses a step function that jumps 20 points at ratio 1.0
 * (`ratio >= 1 ? 80 + (ratio - 1) * 100 : ratio * 60`), so two structures whose
 * ATR ratios differ by 0.001 can score 59.94 and 80. V2 replaces it with a
 * continuous, monotone, piecewise-linear transform that keeps the pass SET
 * unchanged: `ratio >= 1` still scores at or above the 60-point pass line.
 *
 *   v(r) = 0                             r <= 0
 *   v(r) = 60 r                          0 < r <= 1
 *   v(r) = 60 + ((r - 1) / 0.6) * 40     1 < r <= 1.6
 *   v(r) = 100                           r > 1.6
 *
 * Non-finite input fails closed at 0 — a missing measurement is never credited.
 */
export function volatilityScoreV2(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  if (ratio <= 1) return 60 * ratio;
  if (ratio <= 1.6) return 60 + ((ratio - 1) / 0.6) * 40;
  return 100;
}

/** Manifest-recorded parameters for the transform above. */
export const VOLATILITY_V2_PARAMS = {
  passRatio: 1,
  passScore: 60,
  saturationRatio: 1.6,
  saturationScore: 100,
} as const;
