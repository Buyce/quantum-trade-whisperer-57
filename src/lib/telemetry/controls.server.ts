/**
 * Telemetry control room reader.
 *
 * Every operational worker asks this module what it is allowed to do. Two rules
 * make the answer safe:
 *
 *   1. A control row that cannot be read means NOT ALLOWED. A telemetry worker that
 *      keeps sampling because it could not read its own kill switch is exactly the
 *      failure mode the switch exists to prevent.
 *   2. The database may only LOWER the compiled ceilings. A settings edit can never
 *      raise the provider budget above what the code was reviewed for.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { MAX_INSTRUMENTS_PER_RUN, MAX_REQUESTS_PER_RUN } from "./sampler";

export interface TelemetryControls {
  samplerEnabled: boolean;
  aggregationEnabled: boolean;
  retentionEnabled: boolean;
  capacityEnabled: boolean;
  readinessEnabled: boolean;
  samplerSymbols: string[];
  maxInstrumentsPerRun: number;
  maxRequestsPerRun: number;
  dailyRequestBudget: number;
  note: string | null;
  updatedAt: string | null;
  /** True when the row could not be read; every capability is then false. */
  degraded: boolean;
}

const FAIL_CLOSED: TelemetryControls = {
  samplerEnabled: false,
  aggregationEnabled: false,
  retentionEnabled: false,
  capacityEnabled: false,
  readinessEnabled: false,
  samplerSymbols: [],
  maxInstrumentsPerRun: 0,
  maxRequestsPerRun: 0,
  dailyRequestBudget: 0,
  note: null,
  updatedAt: null,
  degraded: true,
};

type Db = Pick<SupabaseClient, "from">;

export async function readTelemetryControls(db: Db): Promise<TelemetryControls> {
  try {
    const { data, error } = await db
      .from("telemetry_controls")
      .select("*")
      .eq("id", true)
      .maybeSingle();
    if (error || !data) return FAIL_CLOSED;

    const row = data as Record<string, unknown>;
    const symbols = Array.isArray(row["sampler_symbols"])
      ? (row["sampler_symbols"] as unknown[]).map(String)
      : [];

    return {
      samplerEnabled: row["sampler_enabled"] === true,
      aggregationEnabled: row["aggregation_enabled"] === true,
      retentionEnabled: row["retention_enabled"] === true,
      capacityEnabled: row["capacity_enabled"] === true,
      readinessEnabled: row["readiness_enabled"] === true,
      samplerSymbols: symbols,
      // Compiled ceiling wins whenever the stored value is larger.
      maxInstrumentsPerRun: Math.min(
        Number(row["max_instruments_per_run"] ?? 0),
        MAX_INSTRUMENTS_PER_RUN,
      ),
      maxRequestsPerRun: Math.min(Number(row["max_requests_per_run"] ?? 0), MAX_REQUESTS_PER_RUN),
      dailyRequestBudget: Number(row["daily_request_budget"] ?? 0),
      note: (row["note"] as string | null) ?? null,
      updatedAt: (row["updated_at"] as string | null) ?? null,
      degraded: false,
    };
  } catch {
    return FAIL_CLOSED;
  }
}
