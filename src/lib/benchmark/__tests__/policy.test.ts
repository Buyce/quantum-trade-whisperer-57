import { describe, expect, it } from "vitest";

import {
  benchmarkPolicyReadiness,
  benchmarkShouldTake,
  type BenchmarkContext,
  type BenchmarkPolicy,
} from "../policy";

const policy: BenchmarkPolicy = {
  enabled: true,
  dryRun: false,
  minGrade: "B",
  instruments: [],
  riskPercent: 1,
  maxConcurrentRisk: null,
  dailyOrderCap: null,
  benchmarkAccountId: "bench-1",
  policyVersion: 4,
};

const ctx: BenchmarkContext = {
  policy,
  accountId: "bench-1",
  accountFlaggedBenchmark: true,
  accountArmed: true,
  alertEligible: true,
  grade: "A",
  instrument: "XAUUSD",
  ordersToday: 0,
  openRiskR: 0,
  alreadyEnqueued: false,
};

describe("benchmark execution policy", () => {
  it("[INVARIANT] a complete policy authorises an alert-eligible publishable grade", () => {
    const verdict = benchmarkShouldTake(ctx);
    expect(verdict.take).toBe(true);
    if (verdict.take) {
      expect(verdict.riskPercent).toBe(1);
      expect(verdict.policyVersion).toBe(4);
      expect(verdict.dryRun).toBe(false);
    }
  });

  it("[INVARIANT] a missing benchmark risk percentage makes execution unavailable, never defaulted", () => {
    const readiness = benchmarkPolicyReadiness({ ...policy, riskPercent: null });
    expect(readiness.usable).toBe(false);
    if (!readiness.usable) expect(readiness.reason).toContain("risk percentage");
    expect(benchmarkShouldTake({ ...ctx, policy: { ...policy, riskPercent: null } }).take).toBe(
      false,
    );
  });

  it("[INVARIANT] an unreadable or absent policy never becomes an enabled policy", () => {
    expect(benchmarkPolicyReadiness(null).usable).toBe(false);
    expect(benchmarkShouldTake({ ...ctx, policy: null }).take).toBe(false);
  });

  it("[INVARIANT] the operator switch alone governs benchmark execution", () => {
    expect(benchmarkShouldTake({ ...ctx, policy: { ...policy, enabled: false } }).take).toBe(false);
  });

  it("[INVARIANT] C is never a benchmark grade and the minimum grade is respected", () => {
    expect(benchmarkShouldTake({ ...ctx, grade: "C" }).take).toBe(false);
    const strict = { ...ctx, policy: { ...policy, minGrade: "A+" as const }, grade: "A" };
    expect(benchmarkShouldTake(strict).take).toBe(false);
    expect(benchmarkShouldTake({ ...strict, grade: "A+" }).take).toBe(true);
  });

  it("[INVARIANT] only alert-eligible setups enter the published record", () => {
    expect(benchmarkShouldTake({ ...ctx, alertEligible: false }).take).toBe(false);
  });

  it("[INVARIANT] database designation and operator configuration must agree", () => {
    expect(benchmarkShouldTake({ ...ctx, accountId: "someone-else" }).take).toBe(false);
    const mismatch = benchmarkShouldTake({ ...ctx, accountFlaggedBenchmark: false });
    expect(mismatch.take).toBe(false);
    if (!mismatch.take) expect(mismatch.reason).toContain("flagged");
  });

  it("[INVARIANT] the benchmark account must pass the Stage-3 arming gates", () => {
    expect(benchmarkShouldTake({ ...ctx, accountArmed: false }).take).toBe(false);
  });

  it("[INVARIANT] the policy's own instrument list scopes the record", () => {
    const scoped = { ...ctx, policy: { ...policy, instruments: ["EURUSD"] } };
    expect(benchmarkShouldTake(scoped).take).toBe(false);
    expect(benchmarkShouldTake({ ...scoped, instrument: "EURUSD" }).take).toBe(true);
  });

  it("[INVARIANT] the policy's own daily order cap applies", () => {
    const capped = { ...ctx, policy: { ...policy, dailyOrderCap: 2 } };
    expect(benchmarkShouldTake({ ...capped, ordersToday: 1 }).take).toBe(true);
    expect(benchmarkShouldTake({ ...capped, ordersToday: 2 }).take).toBe(false);
  });

  it("[INVARIANT] unknown open risk refuses rather than assuming flat", () => {
    const bounded = { ...ctx, policy: { ...policy, maxConcurrentRisk: 3 } };
    expect(benchmarkShouldTake({ ...bounded, openRiskR: null }).take).toBe(false);
    expect(benchmarkShouldTake({ ...bounded, openRiskR: 2 }).take).toBe(true);
    expect(benchmarkShouldTake({ ...bounded, openRiskR: 3 }).take).toBe(false);
  });

  it("[INVARIANT] exactly one benchmark order may exist per setup", () => {
    expect(benchmarkShouldTake({ ...ctx, alreadyEnqueued: true }).take).toBe(false);
  });

  it("[INVARIANT] dry-run is carried from the policy, not inferred", () => {
    const verdict = benchmarkShouldTake({ ...ctx, policy: { ...policy, dryRun: true } });
    expect(verdict.take).toBe(true);
    if (verdict.take) expect(verdict.dryRun).toBe(true);
  });
});
