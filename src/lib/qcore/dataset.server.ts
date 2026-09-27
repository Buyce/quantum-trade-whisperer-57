import type { SupabaseClient } from "@supabase/supabase-js";
import { REPLAY_V2_VERSION, EXECUTION_POLICY_V2 } from "@/lib/execution/replay-registry";
import { QCORE_MODEL_VERSION, QCORE_POLICY_V2 } from "./config";
import type { QCoreBacktestObservation } from "./backtest";
import type { QCoreInput } from "./types";

const ROW_LIMIT = 5000;

interface ObservationDbRow {
  observation_key: string | null;
  instrument: string;
  code_hash: string | null;
  profile: unknown;
}

interface OutcomeDbRow {
  observation_key: string | null;
  instrument: string;
  detected_at: string;
  status: string;
  resolved_outcome: string | null;
  data_quality_outcome: string | null;
  realized_r: number | string | null;
  filled_at: string | null;
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function parseQCoreInput(profile: unknown): QCoreInput | null {
  if (!profile || typeof profile !== "object") return null;
  const p = profile as Record<string, unknown>;
  if (p["policyId"] !== QCORE_POLICY_V2.id || p["featureSchemaVersion"] !== QCORE_POLICY_V2.featureSchemaVersion) return null;
  const raw = p["input"];
  if (!raw || typeof raw !== "object") return null;
  const x = raw as Record<string, unknown>;
  const direction = x["direction"];
  if (direction !== "long" && direction !== "short") return null;
  if (!finite(x["trend"]) || !finite(x["orderBlock"]) || !finite(x["momentum"]) || !finite(x["volatilityExpansion"])) return null;
  const nullableNumber = (v: unknown) => v === null || finite(v);
  if (!nullableNumber(x["rr"]) || !nullableNumber(x["maxR"]) || !nullableNumber(x["regimeWinRate"]) || !nullableNumber(x["executionQuality"])) return null;
  if (typeof x["regimeActive"] !== "boolean") return null;
  return {
    direction,
    trend: x["trend"],
    orderBlock: x["orderBlock"],
    momentum: x["momentum"],
    volatilityExpansion: x["volatilityExpansion"],
    rr: x["rr"] as number | null,
    maxR: x["maxR"] as number | null,
    regimeWinRate: x["regimeWinRate"] as number | null,
    regimeActive: x["regimeActive"],
    executionQuality: x["executionQuality"] as number | null,
  };
}

function effectiveOutcome(row: OutcomeDbRow): { realizedR: number | null; filled: boolean | null } {
  if (row.status !== "resolved") return { realizedR: null, filled: null };
  if (row.data_quality_outcome === "invalid_plan" || row.data_quality_outcome === "gap_beyond_stop") {
    return { realizedR: null, filled: null };
  }
  if (row.resolved_outcome === "never_filled") return { realizedR: 0, filled: false };
  const value = row.realized_r === null ? null : Number(row.realized_r);
  return {
    realizedR: value !== null && Number.isFinite(value) ? value : null,
    filled: row.filled_at ? true : value === null ? null : true,
  };
}

export function joinQCoreOutcomes(
  observations: readonly ObservationDbRow[],
  outcomes: readonly OutcomeDbRow[],
): QCoreBacktestObservation[] {
  const byKey = new Map<string, ObservationDbRow>();
  for (const row of observations) {
    if (!row.observation_key || row.code_hash !== QCORE_POLICY_V2.id) continue;
    byKey.set(`${row.observation_key}|${row.instrument}`, row);
  }

  const joined: QCoreBacktestObservation[] = [];
  for (const outcome of outcomes) {
    if (!outcome.observation_key) continue;
    const observation = byKey.get(`${outcome.observation_key}|${outcome.instrument}`);
    if (!observation) continue;
    const input = parseQCoreInput(observation.profile);
    if (!input) continue;
    const result = effectiveOutcome(outcome);
    joined.push({
      id: outcome.observation_key,
      detectedAt: outcome.detected_at,
      instrument: outcome.instrument,
      input,
      realizedR: result.realizedR,
      filled: result.filled,
    });
  }
  return joined;
}

/**
 * Loads only Q-Core v4 observations that carry an exact decision-time feature
 * snapshot and joins them to corrected Replay-V2 research outcomes.
 * Missing/mismatched provenance is excluded rather than inferred.
 */
export async function loadQCoreBacktestDataset(db: SupabaseClient): Promise<QCoreBacktestObservation[]> {
  const [{ data: observations, error: observationError }, { data: outcomes, error: outcomeError }] =
    await Promise.all([
      db
        .from("model_observations")
        .select("observation_key, instrument, code_hash, profile")
        .eq("model_version", QCORE_MODEL_VERSION)
        .eq("code_hash", QCORE_POLICY_V2.id)
        .limit(ROW_LIMIT),
      db
        .from("shadow_executions")
        .select("observation_key, instrument, detected_at, status, resolved_outcome, data_quality_outcome, realized_r, filled_at")
        .eq("cohort", "research_candidate")
        .eq("plan_origin", "production")
        .eq("replay_version", REPLAY_V2_VERSION)
        .eq("execution_policy", EXECUTION_POLICY_V2)
        .limit(ROW_LIMIT),
    ]);
  if (observationError) throw new Error(`Q-Core observation read failed: ${observationError.message}`);
  if (outcomeError) throw new Error(`Q-Core Replay-V2 outcome read failed: ${outcomeError.message}`);
  return joinQCoreOutcomes(
    (observations ?? []) as unknown as ObservationDbRow[],
    (outcomes ?? []) as unknown as OutcomeDbRow[],
  );
}
