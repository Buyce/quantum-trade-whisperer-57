/**
 * Recovering the characterisation (signal reference, instrument, grade) of a
 * broker-confirmed trade whose signal and delivery rows were deleted by the
 * retention purge.
 *
 * Nothing here is inferred from prices or invented. The recovery rests on two
 * facts that survived the purge:
 *
 *  1. every P-Trades order id has the shape `PT_<signal-tail>_<delivery-id>`,
 *     where the signal tail is the last N characters of the original signal id
 *     with its dashes stripped (see `buildClientId`);
 *  2. `execution_enqueue_decisions` is never purged and records, per signal id,
 *     the instrument and grade P-Trades acted on plus when it first decided.
 *
 * A match is accepted ONLY when it is unambiguous: exactly one signal id, one
 * grade and one instrument, and the instrument agrees with the broker's own
 * symbol. Anything else leaves the characterisation unset, because a wrong grade
 * would poison every statistic that reads it.
 *
 * Pure module: no fetch, no env, no clock.
 */
import { parseClientId } from "@/lib/metaapi/client-id";

/** The only grades P-Trades publishes. Anything else is not a grade. */
const GRADES = new Set(["A+", "A", "B", "C"]);

export const RECOVERED_GRADE_SOURCE = "recovered_from_enqueue_decision" as const;

/** One decision-log row, as the recovery reads it. */
export interface DecisionCandidate {
  signal_id: string | null;
  instrument: string | null;
  grade: string | null;
  created_at: string;
}

export interface RecoveredCharacterisation {
  signalId: string;
  instrument: string;
  grade: string;
  /**
   * Earliest recorded decision for this setup. It is a lower bound on when the
   * signal existed — NOT its detection time, and never presented as one.
   */
  firstDecisionAt: string;
  source: typeof RECOVERED_GRADE_SOURCE;
}

/** Hex form of a uuid, for tail comparison. */
function bare(id: string): string {
  return id.replace(/-/g, "").toLowerCase();
}

/**
 * The signal reference carried inside a P-Trades order id, or null when the id
 * was not produced by P-Trades.
 */
export function signalTailFromClientId(clientId: string | null | undefined): string | null {
  const parts = parseClientId(clientId);
  if (!parts) return null;
  const tail = parts.positionRef.toLowerCase();
  // A very short tail could match many signals; refuse to guess.
  return tail.length >= 8 ? tail : null;
}

/** TRUE when this signal id ends with the tail the broker order carries. */
export function tailMatchesSignalId(tail: string, signalId: string | null | undefined): boolean {
  if (!signalId) return false;
  const hex = bare(signalId);
  return hex.length >= tail.length && hex.endsWith(tail);
}

/**
 * Resolve the characterisation of one broker order from decision-log rows.
 *
 * Returns null unless the match is unique and internally consistent.
 */
export function resolveCharacterisationFromDecisions(
  clientId: string | null | undefined,
  brokerSymbol: string | null | undefined,
  candidates: readonly DecisionCandidate[],
): RecoveredCharacterisation | null {
  const tail = signalTailFromClientId(clientId);
  if (!tail) return null;

  const matched = candidates.filter((row) => tailMatchesSignalId(tail, row.signal_id));
  if (matched.length === 0) return null;

  const signalIds = new Set(matched.map((row) => (row.signal_id as string).toLowerCase()));
  if (signalIds.size !== 1) return null;

  const grades = new Set(matched.map((row) => row.grade).filter((g): g is string => !!g));
  const instruments = new Set(
    matched.map((row) => row.instrument?.toUpperCase()).filter((i): i is string => !!i),
  );
  if (grades.size !== 1 || instruments.size !== 1) return null;

  const grade = [...grades][0] as string;
  const instrument = [...instruments][0] as string;
  if (!GRADES.has(grade)) return null;
  if (brokerSymbol && brokerSymbol.toUpperCase() !== instrument) return null;

  const firstDecisionAt = matched
    .map((row) => row.created_at)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] as string;

  return {
    signalId: matched[0]!.signal_id as string,
    instrument,
    grade,
    firstDecisionAt,
    source: RECOVERED_GRADE_SOURCE,
  };
}

/** Fields written onto an evidence row when a characterisation is recovered. */
export function recoveredCharacterisationFields(
  recovered: RecoveredCharacterisation,
): Record<string, unknown> {
  return {
    // `signal_id` is a foreign key to `scanned_signals`; for a recovered trade
    // that row was physically deleted, so the reference is stored in the
    // non-foreign-key `signal_ref` instead of being dropped.
    signal_ref: recovered.signalId,
    signal_instrument: recovered.instrument,
    signal_grade: recovered.grade,
    signal_grade_source: recovered.source,
    signal_first_decision_at: recovered.firstDecisionAt,
  };
}
