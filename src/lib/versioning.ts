/**
 * Model version identity.
 *
 * Every observation the engine writes (`scanned_signals`, `shadow_executions`,
 * `regime_stats`, `regime_snapshots`) carries a `model_version`. V1 is the
 * engine as it ran when the quantitative integrity baseline was captured.
 *
 * RULES
 * - Read paths MUST filter on `ACTIVE_MODEL_VERSION` so no panel, email or MCP
 *   tool can ever be handed a mixed cohort.
 * - A corrected engine (V2) writes research rows only: `shadow_executions` with
 *   `model_version = 2` and `signal_id = NULL`. It must never insert into
 *   `scanned_signals`, which is what drives the feed, the dedup index, the
 *   enrolment trigger and every alert channel.
 */
export const ACTIVE_MODEL_VERSION = 1;

/** Registry label for the active version; the full record lives in `model_versions`. */
export const ACTIVE_MODEL_LABEL = "V1 production engine";

/**
 * Pairing key for one market observation: a single scan cycle's read of a
 * single instrument. V1 and a future V2 evaluate the *same* in-memory candle
 * arrays, so an identical key on both rows makes every difference attributable
 * to logic rather than to data.
 */
export function observationKey(
  runId: string | null | undefined,
  instrument: string,
): string | null {
  if (!runId || !instrument) return null;
  return `${runId}:${instrument}`;
}
