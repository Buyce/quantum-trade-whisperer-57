/**
 * Shared decision-write semantics for the web terminal and MCP.
 *
 * Two rules, enforced identically on both writers:
 *
 *  1. INSERT initialises state and captures the immutable journal snapshot.
 *     UPDATE changes decision + provenance only — `outcome` never appears in an
 *     update payload, so a repeat write can never reset a resolved trade.
 *  2. A resolved row is not touched at all: the caller gets a friendly
 *     already-resolved result instead of a database error.
 *
 * This module is pure: callers do the I/O.
 */

export interface SignalSnapshotSource {
  id: string;
  detected_at: string;
  instrument: string;
  grade: string;
  direction: "long" | "short";
  entry_price: number;
  stop_loss: number;
  market_context?:
    | { trading_session: string | null; time_of_day: number | null; day_of_week: number | null }
    | Array<{
        trading_session: string | null;
        time_of_day: number | null;
        day_of_week: number | null;
      }>
    | null;
}

export interface JournalSnapshot {
  planned_entry: number;
  planned_stop: number;
  planned_direction: "long" | "short";
  signal_detected_at: string;
  signal_instrument: string;
  signal_grade: string;
  signal_trading_session: string | null;
  signal_time_of_day: number | null;
  signal_day_of_week: number | null;
}

/**
 * The nine immutable fields, captured when the journal row is FIRST created.
 * After this the journal row no longer depends on the signal row existing.
 */
export function buildJournalSnapshot(signal: SignalSnapshotSource): JournalSnapshot {
  const rawCtx = signal.market_context;
  const ctx = Array.isArray(rawCtx) ? (rawCtx[0] ?? null) : (rawCtx ?? null);
  const detected = new Date(signal.detected_at);
  return {
    planned_entry: Number(signal.entry_price),
    planned_stop: Number(signal.stop_loss),
    planned_direction: signal.direction,
    signal_detected_at: signal.detected_at,
    signal_instrument: signal.instrument,
    signal_grade: signal.grade,
    signal_trading_session: ctx?.trading_session ?? null,
    signal_time_of_day: ctx?.time_of_day ?? detected.getUTCHours(),
    signal_day_of_week: ctx?.day_of_week ?? detected.getUTCDay(),
  };
}

export type DecisionAction = "insert" | "update" | "already_resolved";

export interface DecisionPlan {
  action: DecisionAction;
  message: string;
}

/** Decides what a decision write may do to an existing row. */
export function planDecisionWrite(
  existing: { id: string; outcome: string; user_decision: string } | null,
  decision: "taken" | "skipped",
): DecisionPlan {
  if (!existing) {
    return { action: "insert", message: `Logged ${decision}.` };
  }
  if (existing.outcome !== "open") {
    return {
      action: "already_resolved",
      message: `This trade is already resolved as ${existing.outcome}. The decision was left unchanged. Use a correction workflow to change a resolved trade.`,
    };
  }
  if (existing.user_decision === decision) {
    return { action: "update", message: `Already logged as ${decision}.` };
  }
  return { action: "update", message: `Updated to ${decision}.` };
}

export interface DecisionResult {
  ok: boolean;
  action: DecisionAction;
  alreadyResolved: boolean;
  message: string;
}
