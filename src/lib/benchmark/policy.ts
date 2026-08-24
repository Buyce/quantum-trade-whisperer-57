/**
 * Prompt 14 Stage 5 (pre-flight 4) — the BENCHMARK policy, as pure rules.
 *
 * The benchmark account exists to produce ONE honest, broker-verified track
 * record of the published strategy. It therefore runs on a persisted, versioned,
 * operator-owned policy — never on a customer's settings:
 *
 *  - it only trades setups that passed the canonical alert eligibility gate, so
 *    the record matches what traders were actually shown;
 *  - it never trades a grade the strategy does not publish (C is not eligible);
 *  - its risk percentage is its OWN. A missing risk percentage makes benchmark
 *    execution UNAVAILABLE rather than borrowing a default or a customer's;
 *  - its instrument list, daily order cap and concurrent-risk ceiling are its
 *    own, so a customer's feed filters or daily cap can never shape the record;
 *  - exactly one benchmark order may exist per signal.
 *
 * Pure: no I/O, no clock, no env.
 */

/** Grades the benchmark account is permitted to take. C is never eligible. */
export const BENCHMARK_GRADES = ["A+", "A", "B"] as const;

export type BenchmarkGrade = (typeof BENCHMARK_GRADES)[number];

const GRADE_RANK: Record<BenchmarkGrade, number> = { "A+": 3, A: 2, B: 1 };

export function isBenchmarkGrade(value: unknown): value is BenchmarkGrade {
  return typeof value === "string" && (BENCHMARK_GRADES as readonly string[]).includes(value);
}

/**
 * The persisted operator policy (`public.benchmark_policy`), one row.
 *
 * `policyVersion` is bumped by the database whenever any decision-bearing field
 * changes, and it is stamped onto every benchmark delivery so a record can never
 * be attributed to a policy it was not produced under.
 */
export interface BenchmarkPolicy {
  enabled: boolean;
  dryRun: boolean;
  minGrade: BenchmarkGrade;
  /** Empty ⇒ every scanned instrument is in scope. */
  instruments: string[];
  /** Null ⇒ benchmark execution is UNAVAILABLE. Never defaulted. */
  riskPercent: number | null;
  /** Maximum benchmark risk (in R) that may be live at once. Null ⇒ unbounded. */
  maxConcurrentRisk: number | null;
  /** Null ⇒ uncapped. */
  dailyOrderCap: number | null;
  /** The canonical benchmark account. Null ⇒ unavailable. */
  benchmarkAccountId: string | null;
  policyVersion: number;
}

export type PolicyReadiness =
  | { usable: true; policy: BenchmarkPolicy & { riskPercent: number; benchmarkAccountId: string } }
  | { usable: false; reason: string };

/**
 * Is this policy complete enough to authorize any benchmark order at all?
 *
 * Deliberately separate from the per-signal decision so the admin surface can
 * say "benchmark execution is unavailable because no risk percentage is set"
 * without evaluating a signal.
 */
export function benchmarkPolicyReadiness(policy: BenchmarkPolicy | null): PolicyReadiness {
  if (!policy) return { usable: false, reason: "no benchmark policy is stored" };
  if (!policy.enabled) return { usable: false, reason: "benchmark execution is switched off" };
  if (policy.riskPercent === null || !(policy.riskPercent > 0)) {
    return {
      usable: false,
      reason:
        "benchmark execution is unavailable: no benchmark risk percentage is configured, and no default is assumed",
    };
  }
  if (!policy.benchmarkAccountId) {
    return { usable: false, reason: "no benchmark account is designated in the policy" };
  }
  if (!isBenchmarkGrade(policy.minGrade)) {
    return { usable: false, reason: `minimum grade ${String(policy.minGrade)} is not publishable` };
  }
  return {
    usable: true,
    policy: policy as BenchmarkPolicy & { riskPercent: number; benchmarkAccountId: string },
  };
}

export interface BenchmarkContext {
  policy: BenchmarkPolicy | null;
  /**
   * The account this delivery would be sent to. Must equal
   * `policy.benchmarkAccountId` AND be flagged `is_benchmark` in the database,
   * so configuration and designation cannot silently disagree.
   */
  accountId: string | null;
  accountFlaggedBenchmark: boolean;
  /** The account passes every Stage-3 arming gate for automatic demo orders. */
  accountArmed: boolean;
  /** The setup passed the canonical Prompt-10 alert eligibility gate. */
  alertEligible: boolean;
  grade: string;
  instrument: string;
  /** Benchmark orders already enqueued today (UTC day). */
  ordersToday: number;
  /** Benchmark risk currently live, in R. Null ⇒ unknown, which refuses. */
  openRiskR: number | null;
  /** A benchmark delivery already exists for this signal. */
  alreadyEnqueued: boolean;
}

export type BenchmarkVerdict =
  | { take: true; dryRun: boolean; riskPercent: number; policyVersion: number }
  | { take: false; reason: string };

export function benchmarkShouldTake(ctx: BenchmarkContext): BenchmarkVerdict {
  const readiness = benchmarkPolicyReadiness(ctx.policy);
  if (!readiness.usable) return { take: false, reason: readiness.reason };
  const policy = readiness.policy;

  // Designation binding: the database flag and the configured account must be
  // the same account, or the resulting evidence could be mislabelled.
  if (!ctx.accountId || ctx.accountId !== policy.benchmarkAccountId) {
    return {
      take: false,
      reason: "this account is not the benchmark account named in the operator policy",
    };
  }
  if (!ctx.accountFlaggedBenchmark) {
    return {
      take: false,
      reason:
        "the configured benchmark account is not flagged as the benchmark account in the database, so its evidence class cannot be trusted",
    };
  }
  if (!ctx.accountArmed) {
    return { take: false, reason: "the benchmark account is not armed for automatic demo orders" };
  }
  if (!ctx.alertEligible) {
    return {
      take: false,
      reason: "the setup is not alert-eligible, so it is not part of the record",
    };
  }
  if (!isBenchmarkGrade(ctx.grade)) {
    return { take: false, reason: `grade ${ctx.grade} is outside the benchmark policy` };
  }
  if (GRADE_RANK[ctx.grade] < GRADE_RANK[policy.minGrade]) {
    return {
      take: false,
      reason: `grade ${ctx.grade} is below the benchmark minimum of ${policy.minGrade}`,
    };
  }
  if (policy.instruments.length > 0 && !policy.instruments.includes(ctx.instrument)) {
    return { take: false, reason: `${ctx.instrument} is not in the benchmark instrument list` };
  }
  if (policy.dailyOrderCap !== null && ctx.ordersToday >= policy.dailyOrderCap) {
    return {
      take: false,
      reason: `the benchmark daily order cap of ${policy.dailyOrderCap} is already used`,
    };
  }
  if (policy.maxConcurrentRisk !== null) {
    if (ctx.openRiskR === null) {
      return {
        take: false,
        reason:
          "benchmark open risk is unknown, so the concurrent-risk ceiling cannot be respected",
      };
    }
    if (ctx.openRiskR + 1 > policy.maxConcurrentRisk) {
      return {
        take: false,
        reason: `benchmark open risk of ${ctx.openRiskR}R plus this setup would exceed the ${policy.maxConcurrentRisk}R ceiling`,
      };
    }
  }
  if (ctx.alreadyEnqueued) {
    return { take: false, reason: "a benchmark order already exists for this setup" };
  }
  return {
    take: true,
    dryRun: policy.dryRun,
    riskPercent: policy.riskPercent,
    policyVersion: policy.policyVersion,
  };
}
