/**
 * Pipeline freshness verdict. A cron trigger firing is not evidence a worker
 * finished; only stored output timestamps are. Unreadable counts as failing.
 */
export const SCAN_STALE_MS = 30 * 60_000;

export type Freshness = {
  ok: boolean;
  reason: "fresh" | "stale" | "unreadable" | "market_closed";
  lastSampleAt: string | null;
  lastSampleOk: boolean | null;
};

/** FX closes Fri 22:00 UTC to Sun 22:00 UTC. */
export function fxMarketClosed(now: Date): boolean {
  const d = now.getUTCDay();
  const h = now.getUTCHours();
  return d === 6 || (d === 5 && h >= 22) || (d === 0 && h < 22);
}

export function judgeFreshness(input: {
  now: Date;
  readError: string | null;
  lastSampleAt: string | null;
  lastSampleOk: boolean | null;
}): Freshness {
  const base = { lastSampleAt: input.lastSampleAt, lastSampleOk: input.lastSampleOk };
  if (input.readError) return { ok: false, reason: "unreadable", ...base };
  if (fxMarketClosed(input.now)) return { ok: true, reason: "market_closed", ...base };
  const at = input.lastSampleAt ? Date.parse(input.lastSampleAt) : NaN;
  if (!Number.isFinite(at) || input.now.getTime() - at > SCAN_STALE_MS || input.lastSampleOk !== true)
    return { ok: false, reason: "stale", ...base };
  return { ok: true, reason: "fresh", ...base };
}
