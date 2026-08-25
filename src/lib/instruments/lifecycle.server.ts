/**
 * Instrument lifecycle — the server reader (Phase A / A3).
 *
 * Two facts come from the database:
 *   - `instrument_lifecycle.stage` per symbol;
 *   - `execution_controls.lifecycle_enforced`, the operational switch, so
 *     enforcement can be turned on or rolled back without a redeploy.
 *
 * Every read is wrapped: a lifecycle outage must never take the product down, so
 * a failure degrades to the frozen Wave 0 answer (see `fallbackStage`) rather than
 * throwing into a scan job or a delivery worker.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { REGISTRY_SYMBOLS } from "./registry";
import { fallbackStage, isStage, type InstrumentStage, type StageMap } from "./lifecycle";

export interface LifecycleView {
  enforced: boolean;
  stages: StageMap;
  /** True when either read failed, so callers can log the degraded path. */
  degraded: boolean;
}

function frozenStages(): StageMap {
  const out: StageMap = {};
  for (const symbol of REGISTRY_SYMBOLS) out[symbol] = fallbackStage(symbol);
  return out;
}

export async function readLifecycleEnforced(db: SupabaseClient): Promise<boolean | null> {
  try {
    const { data, error } = await db
      .from("execution_controls")
      .select("lifecycle_enforced")
      .eq("id", true)
      .maybeSingle();
    if (error) return null;
    return Boolean((data as { lifecycle_enforced?: boolean } | null)?.lifecycle_enforced);
  } catch {
    return null;
  }
}

export async function readStages(db: SupabaseClient): Promise<StageMap | null> {
  try {
    const { data, error } = await db.from("instrument_lifecycle").select("symbol, stage");
    if (error || !data) return null;
    const out: StageMap = {};
    for (const row of data as { symbol: string; stage: string }[]) {
      if (isStage(row.stage)) out[row.symbol] = row.stage;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * One combined read for a worker pass. When anything is unreadable the view is
 * marked degraded and filled with the frozen Wave 0 answer; enforcement is
 * treated as OFF in that case, which keeps today's behaviour exactly.
 */
export async function readLifecycleView(db: SupabaseClient): Promise<LifecycleView> {
  const [enforced, stages] = await Promise.all([readLifecycleEnforced(db), readStages(db)]);
  const degraded = enforced === null || stages === null;
  if (degraded) {
    console.warn("[lifecycle] degraded read — falling back to the frozen Wave 0 universe");
  }
  return {
    enforced: enforced === true && stages !== null,
    stages: stages ?? frozenStages(),
    degraded,
  };
}

/** Records the latest operational verdict for a symbol. Never throws. */
export async function writeDataHealth(
  db: SupabaseClient,
  symbol: string,
  dataHealth: string,
): Promise<void> {
  try {
    await db.from("instrument_lifecycle").update({ data_health: dataHealth }).eq("symbol", symbol);
  } catch {
    // Diagnostic only — a failed health note must not fail the caller.
  }
}

/**
 * Stage transitions are service-role only and ALWAYS append history first, so an
 * approval can never exist without its reason.
 */
export async function transitionStage(
  db: SupabaseClient,
  args: {
    symbol: string;
    to: InstrumentStage;
    reason: string;
    approver: string;
    evidence?: unknown;
    strategyModelVersion?: number;
    codeHash?: string;
    rollbackTarget?: InstrumentStage;
  },
): Promise<{ ok: boolean; error?: string }> {
  const { data: current, error: readError } = await db
    .from("instrument_lifecycle")
    .select("stage")
    .eq("symbol", args.symbol)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  const from = (current as { stage?: string } | null)?.stage ?? null;

  const { error: historyError } = await db.from("instrument_lifecycle_transitions").insert({
    symbol: args.symbol,
    from_stage: from,
    to_stage: args.to,
    reason: args.reason,
    approver: args.approver,
    evidence: args.evidence ?? null,
    strategy_model_version: args.strategyModelVersion ?? null,
    code_hash: args.codeHash ?? null,
    rollback_target: args.rollbackTarget ?? (isStage(from) ? from : null),
  });
  if (historyError) return { ok: false, error: historyError.message };

  const { error } = await db
    .from("instrument_lifecycle")
    .update({ stage: args.to })
    .eq("symbol", args.symbol);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
