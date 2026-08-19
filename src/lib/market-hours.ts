/**
 * Pure FX market-hours maths. Presentation only — nothing here feeds grading,
 * scanning or filtering. All boundaries are UTC.
 *
 * The scanner's own session buckets live in `pipeline.server.ts` (`sessionOf`);
 * `scannerSessionOf` below mirrors those boundaries exactly so the feed never
 * disagrees with the label stored on a signal.
 */

export interface FxSession {
  key: string;
  label: string;
  /** Inclusive UTC hour the session opens. */
  openHour: number;
  /** Exclusive UTC hour the session closes (may wrap past midnight). */
  closeHour: number;
}

/** Real-world liquidity windows (these overlap, unlike the scanner buckets). */
export const FX_SESSIONS: FxSession[] = [
  { key: "sydney", label: "Sydney", openHour: 21, closeHour: 6 },
  { key: "tokyo", label: "Tokyo", openHour: 0, closeHour: 9 },
  { key: "london", label: "London", openHour: 7, closeHour: 16 },
  { key: "new_york", label: "New York", openHour: 12, closeHour: 21 },
];

/** Scanner session bucket — must stay identical to `sessionOf` in pipeline.server.ts. */
export function scannerSessionOf(date: Date): string {
  const h = date.getUTCHours();
  if (h >= 22 || h < 1) return "sydney";
  if (h < 7) return "tokyo";
  if (h < 12) return "london";
  if (h < 16) return "london_new_york_overlap";
  return "new_york";
}

function inWindow(hour: number, openHour: number, closeHour: number): boolean {
  return openHour < closeHour ? hour >= openHour && hour < closeHour : hour >= openHour || hour < closeHour;
}

/**
 * Weekend closure: the FX week ends Friday 21:00 UTC and reopens Sunday 21:00 UTC.
 */
export function isWeekendClosed(now: Date): boolean {
  const day = now.getUTCDay(); // 0 = Sunday
  const hour = now.getUTCHours();
  if (day === 6) return true;
  if (day === 5 && hour >= 21) return true;
  if (day === 0 && hour < 21) return true;
  return false;
}

export interface SessionStatus extends FxSession {
  open: boolean;
  /** Minutes until this session's next open (when closed) or close (when open). */
  minutesToChange: number;
}

function minutesUntilUtcHour(now: Date, hour: number): number {
  const target = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, 0, 0, 0),
  );
  if (target.getTime() <= now.getTime()) target.setUTCDate(target.getUTCDate() + 1);
  return Math.max(1, Math.round((target.getTime() - now.getTime()) / 60_000));
}

export interface MarketStatus {
  weekendClosed: boolean;
  /** Minutes until the weekend closure lifts; null when the market is open. */
  minutesToReopen: number | null;
  scannerSession: string;
  sessions: SessionStatus[];
  openCount: number;
}

export function marketStatus(now: Date): MarketStatus {
  const weekendClosed = isWeekendClosed(now);
  const hour = now.getUTCHours();

  const sessions: SessionStatus[] = FX_SESSIONS.map((s) => {
    const open = !weekendClosed && inWindow(hour, s.openHour, s.closeHour);
    return {
      ...s,
      open,
      minutesToChange: minutesUntilUtcHour(now, open ? s.closeHour : s.openHour),
    };
  });

  let minutesToReopen: number | null = null;
  if (weekendClosed) {
    const day = now.getUTCDay();
    const reopen = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 21, 0, 0, 0),
    );
    // Walk forward to the next Sunday 21:00 UTC.
    const daysToSunday = (7 - day) % 7;
    reopen.setUTCDate(reopen.getUTCDate() + daysToSunday);
    if (reopen.getTime() <= now.getTime()) reopen.setUTCDate(reopen.getUTCDate() + 7);
    minutesToReopen = Math.max(1, Math.round((reopen.getTime() - now.getTime()) / 60_000));
  }

  return {
    weekendClosed,
    minutesToReopen,
    scannerSession: scannerSessionOf(now),
    sessions,
    openCount: sessions.filter((s) => s.open).length,
  };
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
