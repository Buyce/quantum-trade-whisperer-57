/**
 * Wilson score interval and Newcombe difference interval.
 *
 * IMPORTANT: these assume independent Bernoulli trials. P-Trades observations
 * are NOT independent (overlapping plans within a trading day share regime), so
 * these are DESCRIPTIVE DIAGNOSTICS ONLY. The primary interval is the whole-UTC
 * day cluster bootstrap in `bootstrap.ts`. Never present a Wilson interval as
 * inferential evidence.
 */

export const DIAGNOSTIC_ONLY_NOTE =
  "Descriptive diagnostic: assumes independent observations, which P-Trades data violates.";

export interface Interval {
  lo: number;
  hi: number;
  level: number;
  method: string;
  diagnosticOnly: true;
}

/** Two-sided normal quantile for common levels. */
export function zFor(level: number): number {
  if (level === 0.9) return 1.6448536269514722;
  if (level === 0.95) return 1.959963984540054;
  if (level === 0.99) return 2.5758293035489004;
  throw new Error(`Unsupported confidence level: ${level}`);
}

export function wilsonInterval(successes: number, n: number, level = 0.95): Interval | null {
  if (!Number.isInteger(successes) || !Number.isInteger(n)) return null;
  if (n <= 0 || successes < 0 || successes > n) return null;
  const z = zFor(level);
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return {
    lo: Math.max(0, centre - half),
    hi: Math.min(1, centre + half),
    level,
    method: "wilson_score",
    diagnosticOnly: true,
  };
}

/**
 * Newcombe hybrid score interval for a difference of two proportions, built
 * from the two Wilson intervals. Diagnostic only, same independence caveat.
 */
export function newcombeDifference(
  a: { successes: number; n: number },
  b: { successes: number; n: number },
  level = 0.95,
): Interval | null {
  const wa = wilsonInterval(a.successes, a.n, level);
  const wb = wilsonInterval(b.successes, b.n, level);
  if (!wa || !wb) return null;
  const pa = a.successes / a.n;
  const pb = b.successes / b.n;
  const diff = pa - pb;
  const lo = diff - Math.sqrt((pa - wa.lo) ** 2 + (wb.hi - pb) ** 2);
  const hi = diff + Math.sqrt((wa.hi - pa) ** 2 + (pb - wb.lo) ** 2);
  return {
    lo: Math.max(-1, lo),
    hi: Math.min(1, hi),
    level,
    method: "newcombe_hybrid_score",
    diagnosticOnly: true,
  };
}
