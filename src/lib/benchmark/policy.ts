/**
 * Prompt 14 Stage 3 closure (H) — the benchmark demo policy, as pure rules.
 *
 * The benchmark account exists to produce ONE honest, broker-verified track
 * record of the published strategy. Its policy is therefore deliberately
 * narrower than a customer's:
 *
 *  - it only ever trades setups that passed the canonical alert eligibility
 *    gate, so the record matches what traders were actually shown;
 *  - it never trades a grade the strategy does not publish;
 *  - it is switched on by a dedicated operator flag (`benchmark_auto_enabled`)
 *    that is separate from the customer Demo-Auto switch, so enabling customer
 *    execution never silently starts the benchmark, or the reverse;
 *  - exactly one benchmark order may exist per signal.
 *
 * Pure: no I/O, no clock, no env.
 */

/** Grades the benchmark account is permitted to take. */
export const BENCHMARK_GRADES = ["A+", "A", "B"] as const;

export type BenchmarkGrade = (typeof BENCHMARK_GRADES)[number];

export interface BenchmarkContext {
  /** Operator switch dedicated to the benchmark account. */
  benchmarkAutoEnabled: boolean;
  /** A benchmark MetaApi account is configured for this deployment. */
  configured: boolean;
  /**
   * The configured benchmark account is present as a connected account and is
   * armed for automatic demo orders (it goes through every Stage-3 gate).
   */
  accountArmed: boolean;
  /** The setup passed the canonical Prompt-10 alert eligibility gate. */
  alertEligible: boolean;
  grade: string;
  /** A benchmark delivery already exists for this signal. */
  alreadyEnqueued: boolean;
}

export type BenchmarkVerdict = { take: true } | { take: false; reason: string };

export function benchmarkShouldTake(ctx: BenchmarkContext): BenchmarkVerdict {
  if (!ctx.configured) return { take: false, reason: "no benchmark account is configured" };
  if (!ctx.benchmarkAutoEnabled) {
    return { take: false, reason: "benchmark auto-execution is switched off" };
  }
  if (!ctx.accountArmed) {
    return { take: false, reason: "the benchmark account is not armed for automatic demo orders" };
  }
  if (!ctx.alertEligible) {
    return { take: false, reason: "the setup is not alert-eligible, so it is not part of the record" };
  }
  if (!(BENCHMARK_GRADES as readonly string[]).includes(ctx.grade)) {
    return { take: false, reason: `grade ${ctx.grade} is outside the benchmark policy` };
  }
  if (ctx.alreadyEnqueued) {
    return { take: false, reason: "a benchmark order already exists for this setup" };
  }
  return { take: true };
}
