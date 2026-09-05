/**
 * Loads the active gate threshold overrides for the scanner.
 *
 * Fail-closed to the code defaults: any read error, malformed row, or
 * out-of-range value yields NO override for that gate rather than a guessed
 * one. Writes to `gate_threshold_overrides` happen only inside the
 * `decide_gate_change()` RPC after owner approval; this reader never writes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GateThresholds } from "./gate-thresholds";

/** Hard sanity band: a threshold outside this is treated as data corruption. */
const MIN_VALUE = 0;
const MAX_VALUE = 100;

export async function loadGateThresholds(db: SupabaseClient): Promise<GateThresholds> {
  try {
    const { data, error } = await db.from("gate_threshold_overrides").select("gate, value");
    if (error || !data) return {};

    const out: GateThresholds = {};
    for (const row of data as { gate: string; value: number | string }[]) {
      const v = Number(row.value);
      if (!Number.isFinite(v) || v <= MIN_VALUE || v > MAX_VALUE) continue;
      if (row.gate === "risk_ceiling") out.maxRiskAtr = v;
      else if (row.gate === "headroom") out.minHeadroomAtr = v;
      else if (row.gate === "reachable_r") out.minReachableR = v;
    }
    return out;
  } catch {
    return {};
  }
}
