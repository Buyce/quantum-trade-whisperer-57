/**
 * Database side of characterisation recovery.
 *
 * Bounded reads of the decision log around the trade's own entry time; the
 * decision on what may be accepted lives in the pure module beside this one.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  resolveCharacterisationFromDecisions,
  signalTailFromClientId,
  type DecisionCandidate,
  type RecoveredCharacterisation,
} from "./grade-recovery";

/** Window either side of the broker fill in which the decision must have been recorded. */
export const DECISION_LOOKUP_WINDOW_DAYS = 14;
/** Hard ceiling on decision rows one lookup may read. */
export const DECISION_LOOKUP_LIMIT = 5000;

type Db = Pick<SupabaseClient, "from">;

async function readDecisions(
  db: Db,
  options: { instrument?: string | null; fromIso?: string; toIso?: string },
): Promise<DecisionCandidate[]> {
  let query = db
    .from("execution_enqueue_decisions")
    .select("signal_id, instrument, grade, created_at")
    .not("signal_id", "is", null);
  if (options.instrument) query = query.eq("instrument", options.instrument);
  if (options.fromIso) query = query.gte("created_at", options.fromIso);
  if (options.toIso) query = query.lte("created_at", options.toIso);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(DECISION_LOOKUP_LIMIT);
  if (error) return [];
  return (data ?? []) as unknown as DecisionCandidate[];
}

/**
 * Recover instrument, grade and signal reference for one broker order, or null
 * when the surviving records cannot prove them.
 */
export async function recoverCharacterisation(
  db: Db,
  input: { clientId: string | null; brokerSymbol: string | null; aroundIso?: string | null },
): Promise<RecoveredCharacterisation | null> {
  if (!signalTailFromClientId(input.clientId)) return null;

  const span = DECISION_LOOKUP_WINDOW_DAYS * 86_400_000;
  const anchor = input.aroundIso ? Date.parse(input.aroundIso) : NaN;
  const window = Number.isFinite(anchor)
    ? { fromIso: new Date(anchor - span).toISOString(), toIso: new Date(anchor + span).toISOString() }
    : {};

  // The broker symbol narrows the read first; a symbol the decision log spells
  // differently falls back to the time window alone rather than giving up.
  const bySymbol = await readDecisions(db, { ...window, instrument: input.brokerSymbol });
  const first = resolveCharacterisationFromDecisions(input.clientId, input.brokerSymbol, bySymbol);
  if (first) return first;

  const byWindow = await readDecisions(db, window);
  return resolveCharacterisationFromDecisions(input.clientId, input.brokerSymbol, byWindow);
}
