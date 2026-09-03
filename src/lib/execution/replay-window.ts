/**
 * Replay-window classification (pure).
 *
 * A shadow row can only be replayed from candles the provider will still return.
 * Provider M15 reads are capped, so a row whose detection time (or replay
 * cursor) sits further back than that cap can never be resolved: it would sit
 * `pending` forever and look like a stuck row rather than a known limitation.
 *
 * This module answers one question and nothing else: given the row's start point
 * and the maximum candle depth we may request, is the row still inside the
 * window? An unparseable timestamp returns `null` — "unknown", never a guess.
 */

/** One M15 bar in milliseconds. */
export const M15_BAR_MS = 15 * 60_000;

/** The label written to `shadow_executions.research_window_status`. */
export const OUTSIDE_REPLAY_WINDOW = "outside_replay_window";

export interface ReplayWindowRow {
  detected_at: string;
  replay_cursor: string | null;
}

/**
 * Bars of M15 history needed to reach `now` from the row's start point,
 * including a small boundary overlap. `null` when the start point is unusable.
 */
export function barsRequiredForRow(
  row: ReplayWindowRow,
  nowMs: number,
  overlapBars = 2,
): number | null {
  const start = Date.parse(row.replay_cursor ?? row.detected_at);
  if (!Number.isFinite(start)) return null;
  const elapsed = Math.ceil((nowMs - start) / M15_BAR_MS);
  return Math.max(1, elapsed) + overlapBars;
}

/**
 * `OUTSIDE_REPLAY_WINDOW` when the row needs more history than the provider cap
 * allows, otherwise `null`. `null` also covers an unknown start point: a row is
 * never labelled unresolvable on the strength of a value we could not read.
 */
export function classifyReplayWindow(
  row: ReplayWindowRow,
  maxCandleDepth: number,
  nowMs: number,
  overlapBars = 2,
): typeof OUTSIDE_REPLAY_WINDOW | null {
  const required = barsRequiredForRow(row, nowMs, overlapBars);
  if (required === null) return null;
  return required > maxCandleDepth ? OUTSIDE_REPLAY_WINDOW : null;
}
