/**
 * Telemetry rollup workers: aggregation, retention and capacity.
 *
 * All three are deliberately thin wrappers over SQL. The reason is not laziness:
 * percentiles, session coverage and missingness must be computed over the FULL row
 * set, and a serverless invocation with a 2-second CPU budget cannot honestly page
 * that data through JavaScript. Doing the arithmetic in Postgres also means the
 * numbers cannot differ between a worker run and an admin read.
 *
 * Every worker is independently kill-switched and fail-closed: if the control row
 * cannot be read, nothing runs.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { readTelemetryControls } from "./controls.server";

type Db = Pick<SupabaseClient, "from" | "rpc">;

export interface WorkerResult {
  ran: boolean;
  reason?: "disabled" | "controls_unreadable" | "failed";
  detail?: unknown;
  error?: string;
}

/** Recompute spread percentiles, coverage and missingness over recent samples. */
export async function runSpreadAggregation(db: Db, days = 8): Promise<WorkerResult> {
  const controls = await readTelemetryControls(db as Pick<SupabaseClient, "from">);
  if (controls.degraded) return { ran: false, reason: "controls_unreadable" };
  if (!controls.aggregationEnabled) return { ran: false, reason: "disabled" };

  const { data, error } = await db.rpc("recompute_spread_stats", { _days: days });
  if (error) return { ran: false, reason: "failed", error: error.message };
  return { ran: true, detail: data };
}

/** Roll telemetry off the end of its retention windows. */
export async function runTelemetryRetention(db: Db): Promise<WorkerResult> {
  const controls = await readTelemetryControls(db as Pick<SupabaseClient, "from">);
  if (controls.degraded) return { ran: false, reason: "controls_unreadable" };
  if (!controls.retentionEnabled) return { ran: false, reason: "disabled" };

  const { data, error } = await db.rpc("purge_telemetry");
  if (error) return { ran: false, reason: "failed", error: error.message };
  return { ran: true, detail: data };
}

export interface CapacitySample {
  source: string;
  runId?: string | null;
  jobDurationMs?: number | null;
  cycleDurationMs?: number | null;
  queueAgeMs?: number | null;
  staleJobs?: number;
  timeouts?: number;
  providerRequests?: number;
  providerErrors?: number;
  providerThrottles?: number;
  candleFailures?: number;
  quoteFailures?: number;
  dbWriteFailures?: number;
  resolverThroughput?: number | null;
  resolverBacklog?: number | null;
  resolverOldestAgeMs?: number | null;
  breakerEvents?: number;
  wave0Publications?: number;
  wave0Alerts?: number;
  wave0ExecutionDecisions?: number;
  details?: Record<string, unknown>;
}

/**
 * Record one capacity observation. Counters default to zero because they are
 * COUNTS OF OBSERVED EVENTS in this run — zero means "none happened", which is a
 * fact, not an absence of data. Latencies default to null because an unmeasured
 * duration is unknown, and reporting it as 0 ms would be a fabrication.
 */
export async function recordCapacitySample(db: Db, sample: CapacitySample): Promise<boolean> {
  const controls = await readTelemetryControls(db as Pick<SupabaseClient, "from">);
  if (controls.degraded || !controls.capacityEnabled) return false;
  try {
    const { error } = await db.from("scanner_capacity_samples").insert({
      run_id: sample.runId ?? null,
      source: sample.source,
      job_duration_ms: sample.jobDurationMs ?? null,
      cycle_duration_ms: sample.cycleDurationMs ?? null,
      queue_age_ms: sample.queueAgeMs ?? null,
      stale_jobs: sample.staleJobs ?? 0,
      timeouts: sample.timeouts ?? 0,
      provider_requests: sample.providerRequests ?? 0,
      provider_errors: sample.providerErrors ?? 0,
      provider_throttles: sample.providerThrottles ?? 0,
      candle_failures: sample.candleFailures ?? 0,
      quote_failures: sample.quoteFailures ?? 0,
      db_write_failures: sample.dbWriteFailures ?? 0,
      resolver_throughput: sample.resolverThroughput ?? null,
      resolver_backlog: sample.resolverBacklog ?? null,
      resolver_oldest_age_ms: sample.resolverOldestAgeMs ?? null,
      breaker_events: sample.breakerEvents ?? 0,
      wave0_publications: sample.wave0Publications ?? 0,
      wave0_alerts: sample.wave0Alerts ?? 0,
      wave0_execution_decisions: sample.wave0ExecutionDecisions ?? 0,
      details: sample.details ?? {},
    });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Resolver-health snapshot: shadow queue depth and the age of its oldest waiting
 * item, read live. Both are facts about the queue, not predictions about it.
 */
export async function readResolverHealth(
  db: Pick<SupabaseClient, "from">,
  now = new Date(),
): Promise<{ backlog: number | null; oldestAgeMs: number | null }> {
  try {
    const { count, error } = await db
      .from("shadow_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    if (error) return { backlog: null, oldestAgeMs: null };

    const { data } = await db
      .from("shadow_queue")
      .select("enqueued_at")
      .eq("status", "pending")
      .order("enqueued_at", { ascending: true })
      .limit(1);
    const oldest = (data as { enqueued_at: string }[] | null)?.[0]?.enqueued_at ?? null;
    const age = oldest ? now.getTime() - Date.parse(oldest) : null;
    return {
      backlog: typeof count === "number" ? count : null,
      oldestAgeMs: age !== null && Number.isFinite(age) ? age : null,
    };
  } catch {
    return { backlog: null, oldestAgeMs: null };
  }
}
