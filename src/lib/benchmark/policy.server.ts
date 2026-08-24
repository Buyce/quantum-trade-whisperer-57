/**
 * Prompt 14 Stage 5 (pre-flight 4) — loading the persisted benchmark policy.
 *
 * The policy row is operator-owned and service-role-writable only. This module
 * does the I/O and hands the pure rules in `./policy.ts` a fully-typed policy,
 * plus the runtime counters (orders today, live risk) those rules need.
 *
 * It also proves the DESIGNATION binding: the policy's `benchmark_account_id`
 * must be the same account the database flags `is_benchmark`. If they disagree,
 * benchmark execution is unavailable — the evidence class would otherwise be a
 * guess.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { benchmarkPolicyReadiness, type BenchmarkGrade, type BenchmarkPolicy } from "./policy";

type Db = Pick<SupabaseClient, "from" | "rpc">;

interface PolicyRow {
  enabled: boolean | null;
  dry_run: boolean | null;
  min_grade: string | null;
  instruments: string[] | null;
  risk_percent: number | string | null;
  max_concurrent_risk: number | string | null;
  daily_order_cap: number | null;
  benchmark_account_id: string | null;
  policy_version: number | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function loadBenchmarkPolicy(db: Db): Promise<BenchmarkPolicy | null> {
  const { data, error } = await db
    .from("benchmark_policy")
    .select(
      "enabled, dry_run, min_grade, instruments, risk_percent, max_concurrent_risk, daily_order_cap, benchmark_account_id, policy_version",
    )
    .maybeSingle();
  // Unreadable policy must never become an enabled policy.
  if (error || !data) return null;
  const row = data as unknown as PolicyRow;
  return {
    enabled: row.enabled === true,
    dryRun: row.dry_run !== false,
    minGrade: (row.min_grade ?? "B") as BenchmarkGrade,
    instruments: Array.isArray(row.instruments) ? row.instruments : [],
    riskPercent: num(row.risk_percent),
    maxConcurrentRisk: num(row.max_concurrent_risk),
    dailyOrderCap: row.daily_order_cap ?? null,
    benchmarkAccountId: row.benchmark_account_id ?? null,
    policyVersion: row.policy_version ?? 0,
  };
}

export interface BenchmarkDesignation {
  ok: boolean;
  accountId: string | null;
  reason: string | null;
  policy: BenchmarkPolicy | null;
}

/**
 * The canonical benchmark account, or a plain reason why there is not one.
 *
 * Both sides must agree: the policy names the account AND the account row is
 * flagged `is_benchmark`. Environment configuration alone is never sufficient.
 */
export async function resolveBenchmarkDesignation(db: Db): Promise<BenchmarkDesignation> {
  const policy = await loadBenchmarkPolicy(db);
  const readiness = benchmarkPolicyReadiness(policy);
  if (!readiness.usable) {
    return { ok: false, accountId: null, reason: readiness.reason, policy };
  }
  const accountId = readiness.policy.benchmarkAccountId;
  const { data } = await db
    .from("connected_trading_accounts")
    .select("id, is_benchmark, disconnected_at")
    .eq("id", accountId)
    .maybeSingle();
  const row = data as { id: string; is_benchmark: boolean; disconnected_at: string | null } | null;
  if (!row) {
    return {
      ok: false,
      accountId,
      reason: "the account named by the benchmark policy does not exist",
      policy,
    };
  }
  if (row.is_benchmark !== true) {
    return {
      ok: false,
      accountId,
      reason:
        "the account named by the benchmark policy is not flagged as the benchmark account, so its evidence cannot be classified as BENCHMARK",
      policy,
    };
  }
  if (row.disconnected_at) {
    return { ok: false, accountId, reason: "the benchmark account is disconnected", policy };
  }
  return { ok: true, accountId, reason: null, policy };
}

/** Benchmark orders enqueued so far in the current UTC day. */
export async function benchmarkOrdersToday(
  db: Db,
  accountId: string,
  now = Date.now(),
): Promise<number> {
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const { count } = await db
    .from("execution_deliveries")
    .select("id", { count: "exact", head: true } as never)
    .eq("connected_account_id", accountId)
    .like("bridge_profile", "benchmark:%")
    .gte("enqueued_at", dayStart.toISOString());
  return count ?? 0;
}
