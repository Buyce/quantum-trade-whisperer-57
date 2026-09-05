/**
 * Historical replay anchoring (pure).
 *
 * The provider returns a bounded number of M15 bars per read, and by default
 * those are the MOST RECENT bars. A research candidate enrolled from history is
 * therefore unreachable from the live tail: its detection sits further back than
 * the cap, so every pass reads bars that cannot contain its outcome and the row
 * stays pending forever.
 *
 * This module computes, for a group of rows on one instrument, the single window
 * of the past that covers the OLDEST row still waiting. `startTime` is the newest
 * bar of that window (MetaApi loads backwards from it); `null` means "the live
 * tail already covers this group", so no extra historical read is needed.
 *
 * Nothing here invents bars. If the provider has no history at the requested
 * instant it returns nothing and the rows simply stay unresolved — an unmeasured
 * candidate remains unmeasured.
 */
import { M15_BAR_MS, type ReplayWindowRow } from "./replay-window";

export interface ReplayAnchor {
  /** Newest bar of the window to request, or null to read the live tail. */
  startTime: string | null;
  /** Bars to request. Always within the provider cap. */
  limit: number;
  /** Start point of the oldest row in the group, for diagnostics. */
  oldestStart: string | null;
}

/**
 * Anchor a bounded window on the oldest row's start point.
 *
 * The window is placed so the oldest row's start sits at its beginning, which
 * gives that row the full depth of bars forward for adjudication. Later rows in
 * the group that fall outside this window are not advanced this pass; they are
 * reached by a later pass once the older rows have resolved and no longer set
 * the anchor. Progress is therefore chronological and monotone.
 */
export function anchorForRows(
  rows: ReplayWindowRow[],
  maxCandleDepth: number,
  nowMs: number,
  overlapBars = 2,
): ReplayAnchor {
  const starts = rows
    .map((row) => Date.parse(row.replay_cursor ?? row.detected_at))
    .filter((ms) => Number.isFinite(ms));
  if (starts.length === 0) {
    return { startTime: null, limit: maxCandleDepth, oldestStart: null };
  }
  const oldest = Math.min(...starts);
  const forwardBars = Math.max(1, maxCandleDepth - overlapBars);
  const anchorMs = oldest + forwardBars * M15_BAR_MS;
  // Within the live tail already: no historical read, use the ordinary path.
  if (anchorMs >= nowMs) {
    return {
      startTime: null,
      limit: maxCandleDepth,
      oldestStart: new Date(oldest).toISOString(),
    };
  }
  return {
    startTime: new Date(anchorMs).toISOString(),
    limit: maxCandleDepth,
    oldestStart: new Date(oldest).toISOString(),
  };
}

/**
 * True when `candles` (already sorted ascending) can say something about a row:
 * the window must reach the row's start point at all. A row whose start is after
 * the last bar of the window is simply not this window's business.
 */
export function windowCoversRow(
  row: ReplayWindowRow,
  candles: Array<{ time: string }>,
): boolean {
  if (candles.length === 0) return false;
  const start = Date.parse(row.replay_cursor ?? row.detected_at);
  if (!Number.isFinite(start)) return false;
  const last = Date.parse(candles[candles.length - 1]!.time);
  if (!Number.isFinite(last)) return false;
  return start <= last;
}
