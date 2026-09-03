/**
 * Honest rendering of the latched research error.
 *
 * `shadow_engine_state.research_last_error` is a LATCH: the first failure
 * writes it and nothing clears it until a later success does. Rendering it
 * unconditionally in red makes an 11-day-old transient deadline look like a
 * live outage. This helper attaches the error's age and a staleness verdict
 * so the panel can distinguish "failing now" from "failed once, long ago".
 */

/** An error older than this is reported as historical, not live. */
export const RESEARCH_ERROR_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface ResearchErrorDescription {
  message: string;
  /** Age of the error in milliseconds at `now`. Never negative. */
  ageMs: number;
  /** True when the error is old enough that it must not read as a live failure. */
  stale: boolean;
}

/** Compact human age: "5 minutes", "3 hours", "11 days". */
export function formatErrorAge(ageMs: number): string {
  const minutes = Math.max(0, Math.floor(ageMs / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Classify a latched research error. Returns null when there is nothing to
 * show — including an unparseable timestamp, which must never crash a panel.
 */
export function describeResearchError(
  message: string | null | undefined,
  at: string | null | undefined,
  now: Date = new Date(),
): ResearchErrorDescription | null {
  if (!message) return null;
  if (!at) {
    // A message with no timestamp cannot be aged; treat it as live so a real
    // failure is never silently downgraded by a bookkeeping gap.
    return { message, ageMs: 0, stale: false };
  }
  const ts = Date.parse(at);
  if (Number.isNaN(ts)) return { message, ageMs: 0, stale: false };
  const ageMs = Math.max(0, now.getTime() - ts);
  return { message, ageMs, stale: ageMs >= RESEARCH_ERROR_STALE_AFTER_MS };
}
