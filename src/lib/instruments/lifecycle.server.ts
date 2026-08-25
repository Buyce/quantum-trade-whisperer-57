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
 * Stage transitions — service-role only, and ATOMIC (Phase A1, Finding 4).
 *
 * The previous implementation inserted the history row and then updated the
 * stage in a second round trip. A failure between the two left an approval record
 * for a transition that never happened, and two concurrent callers could both read
 * the same `from_stage` and both "succeed".
 *
 * Everything is now delegated to `public.transition_instrument_stage`, which in ONE
 * transaction locks the lifecycle row, verifies the caller's expected current
 * stage, validates the destination against the allowed-transition graph, requires a
 * non-empty reason and approver, writes the history row and updates the stage —
 * committing both or neither.
 *
 * ROLLBACKS USE THIS SAME PATH. A direct `update` on `instrument_lifecycle` is not
 * an acceptable rollback: it produces no audit trail.
 */
export async function transitionStage(
  db: SupabaseClient,
  args: {
    symbol: string;
    to: InstrumentStage;
    reason: string;
    approver: string;
    /**
     * The stage the caller believes the instrument is at. Supplying it turns the
     * transition into a compare-and-set; omitting it accepts whatever the current
     * stage is, which is only appropriate for an emergency suspension.
     */
    expectedFrom?: InstrumentStage | null;
    evidence?: unknown;
    strategyModelVersion?: number;
    codeHash?: string;
    rollbackTarget?: InstrumentStage;
  },
): Promise<{ ok: boolean; from?: InstrumentStage; noop?: boolean; error?: string }> {
  const { data, error } = await db.rpc("transition_instrument_stage", {
    _symbol: args.symbol,
    _expected_from: args.expectedFrom ?? null,
    _to: args.to,
    _reason: args.reason,
    _approver: args.approver,
    _evidence: (args.evidence ?? null) as never,
    _rollback_target: args.rollbackTarget ?? null,
    _strategy_model_version: args.strategyModelVersion ?? null,
    _code_hash: args.codeHash ?? null,
  });
  if (error) return { ok: false, error: error.message };
  const result = (data ?? {}) as { from?: string; noop?: boolean };
  return {
    ok: true,
    ...(isStage(result.from) ? { from: result.from } : {}),
    ...(typeof result.noop === "boolean" ? { noop: result.noop } : {}),
  };
}
