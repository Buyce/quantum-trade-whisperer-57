/**
 * Pipeline freshness verdict. A cron trigger firing or an idle worker pass is
 * not evidence of analysis; only finished scan-queue outcomes are. Unreadable
 * counts as failing. The weekend calendar is the scanner's own.
 */
import { isWeekendClosed } from "@/lib/market-hours";

export const SCAN_STALE_MS = 30 * 60_000;

/** Results that prove the engine finished an analysis of fresh data. */
export const ANALYSED_RESULTS = new Set(["published", "no_trade", "duplicate", "rejected"]);

export type ScanOutcome = { instrument: string; result: string | null; finishedAt: string };

export type Freshness = {
  ok: boolean;
  reason: "fresh" | "stale" | "partial" | "unreadable" | "market_closed";
  lastAnalysedAt: string | null;
  analysed: string[];
  /** Finished with a non-analysis outcome (e.g. data validation refused). */
  skipped: string[];
  /** Expected in the scan universe but no finished non-stale outcome. */
  missing: string[];
};

export function judgeFreshness(input: {
  now: Date;
  readError: string | null;
  universe: readonly string[];
  outcomes: readonly ScanOutcome[];
}): Freshness {
  const empty = { lastAnalysedAt: null, analysed: [], skipped: [], missing: [] };
  if (input.readError) return { ok: false, reason: "unreadable", ...empty };
  const cutoff = input.now.getTime() - SCAN_STALE_MS;
  const analysed = new Set<string>();
  const skipped = new Set<string>();
  let last = NaN;
  for (const o of input.outcomes) {
    const at = Date.parse(o.finishedAt);
    if (!Number.isFinite(at) || at < cutoff || !o.result || o.result === "stale") continue;
    if (ANALYSED_RESULTS.has(o.result)) {
      analysed.add(o.instrument);
      if (!(at <= last)) last = at;
    } else skipped.add(o.instrument);
  }
  for (const s of analysed) skipped.delete(s);
  const missing = input.universe.filter((s) => !analysed.has(s) && !skipped.has(s));
  const detail = {
    lastAnalysedAt: Number.isFinite(last) ? new Date(last).toISOString() : null,
    analysed: [...analysed].sort(),
    skipped: [...skipped].sort(),
    missing,
  };
  if (isWeekendClosed(input.now)) return { ok: true, reason: "market_closed", ...detail };
  if (analysed.size === 0) return { ok: false, reason: "stale", ...detail };
  if (missing.length > 0) return { ok: false, reason: "partial", ...detail };
  return { ok: true, reason: "fresh", ...detail };
}
