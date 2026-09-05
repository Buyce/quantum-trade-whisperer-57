/**
 * CANONICAL per-user signal eligibility.
 *
 * One implementation, in TypeScript, shared by the alert fan-out (server), the
 * feed and its realtime toast (client) and the MCP `list_signals` tool. There is
 * deliberately NO SQL mirror of these rules: a second implementation in another
 * language is how the four call sites drifted in the first place.
 *
 * The module is pure — no Supabase, no clock reads beyond the `now` argument —
 * so every rule is unit-testable and deterministic.
 *
 * Cap semantics (binding):
 *   A user's daily cap counts the channel's BASE-ELIGIBLE graded (A+/A/B)
 *   signals of the UTC day, ordered `(detected_at ASC, id ASC)`. The first `cap`
 *   of those are inside the cap; the rest are `daily_cap_reached`. `cap = 0`
 *   means unlimited and C-Grade never consumes cap. Feed and alert have separate
 *   sequences because their grade thresholds differ.
 *
 * Nothing here conditions scanner publication, grading, replay, shadow/research
 * enrolment or any statistic. It only answers "may this user be shown or alerted
 * about this already-published signal".
 */
import { GRADE_RANK, isWithinRetention, type Grade } from "@/lib/db-types";
import { WAVE0_SYMBOLS } from "@/lib/instruments/registry";

export type EligibilityChannel = "feed" | "alert";

export type EligibilityReason =
  | "eligible"
  | "instrument_filtered"
  | "session_filtered"
  | "below_min_grade"
  | "below_alert_grade"
  | "expired_retention"
  | "daily_cap_reached";

export interface EligibilitySignal {
  id: string;
  detected_at: string;
  instrument: string;
  grade: Grade;
  /**
   * Session the pipeline computed, from `market_context`. `null` when the
   * context row is not (yet) readable — the pipeline writes it after the signal,
   * so a missing context must NOT suppress the signal.
   */
  trading_session: string | null;
  /**
   * Direction, when the row carried one. Used ONLY by the optional evidence
   * ranker below; eligibility itself never reads it, so a missing direction can
   * never change whether a signal is eligible.
   */
  direction?: string | null;
}

export interface EligibilitySettings {
  instruments: string[];
  sessions: string[];
  min_grade: Grade;
  alert_min_grade: Grade;
  /** 0 = unlimited. */
  daily_setup_cap: number;
}

export interface EligibilityResult {
  eligible: boolean;
  reason: EligibilityReason;
}

/** Threshold for the channel. The feed and the alert channel differ on purpose. */
export function channelMinGrade(settings: EligibilitySettings, channel: EligibilityChannel): Grade {
  return channel === "feed" ? settings.min_grade : settings.alert_min_grade;
}

/** True when the signal consumes daily-cap allowance at all (C never does). */
export function consumesCap(signal: Pick<EligibilitySignal, "grade">): boolean {
  return signal.grade !== "C";
}

/**
 * Every rule EXCEPT the daily cap. The cap needs the whole day's base-eligible
 * sequence, so it is applied by `evaluateEligibility` using a frame built by
 * `buildCapFrame`.
 *
 * A resolved signal is still base-eligible: resolution alone never hides a feed
 * row. Hiding resolved setups is the user's explicit "Active only" display
 * toggle, not an eligibility rule.
 */
export function baseEligibility(
  signal: EligibilitySignal,
  settings: EligibilitySettings,
  channel: EligibilityChannel,
  now: number,
): EligibilityResult {
  // An empty preference means "the Wave 0 universe", NOT "whatever the scanner
  // happens to cover". Treating it as "all" would silently opt every existing
  // user into each newly promoted pair; joining a new pair must stay a deliberate
  // choice, so the default set is pinned.
  const allowed = settings.instruments.length ? settings.instruments : WAVE0_SYMBOLS;
  if (!allowed.includes(signal.instrument)) {
    return { eligible: false, reason: "instrument_filtered" };
  }
  const min = channelMinGrade(settings, channel);
  if ((GRADE_RANK[signal.grade] ?? 0) < (GRADE_RANK[min] ?? 0)) {
    return {
      eligible: false,
      reason: channel === "feed" ? "below_min_grade" : "below_alert_grade",
    };
  }
  // Missing context ⇒ session unknown ⇒ never session-suppressed (fail open),
  // matching the behaviour the alert fan-out has always had.
  if (
    settings.sessions.length &&
    signal.trading_session !== null &&
    !settings.sessions.includes(signal.trading_session)
  ) {
    return { eligible: false, reason: "session_filtered" };
  }
  if (!isWithinRetention(signal, now)) {
    return { eligible: false, reason: "expired_retention" };
  }
  return { eligible: true, reason: "eligible" };
}

export function utcDayStart(now: number): number {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Optional evidence-based ordering for the cap sequence.
 *
 * Returns a score for a signal, or `null` when the signal's cohort has NOT
 * cleared the evidence bar. Scored signals sort ahead of unscored ones, highest
 * first; everything else keeps the chronological order. Omitting the ranker
 * leaves the sequence purely chronological, which is what the feed and alert
 * channels do — their ordering is a user-visible contract and does not change.
 */
export type CapRanker = (signal: EligibilitySignal) => number | null;

/**
 * The channel's cap sequence for the UTC day: base-eligible, cap-consuming
 * signals in `(detected_at ASC, id ASC)` order. Base eligibility is evaluated at
 * each signal's own detection instant so the sequence is stable for the whole
 * day rather than shifting as retention elapses.
 *
 * With a `ranker`, measured cohorts are ordered by score first so a small cap is
 * spent on the setups the evidence prefers instead of whichever arrived first.
 * Unmeasured setups never outrank measured ones and never lose their relative
 * chronological order.
 */
export function capSequence(
  frame: EligibilitySignal[],
  settings: EligibilitySettings,
  channel: EligibilityChannel,
  now: number,
  ranker?: CapRanker,
): EligibilitySignal[] {
  const dayStart = utcDayStart(now);
  const chronological = frame
    .filter((s) => consumesCap(s))
    .filter((s) => new Date(s.detected_at).getTime() >= dayStart)
    .filter(
      (s) => baseEligibility(s, settings, channel, new Date(s.detected_at).getTime()).eligible,
    )
    .sort((a, b) => {
      const ta = new Date(a.detected_at).getTime();
      const tb = new Date(b.detected_at).getTime();
      if (ta !== tb) return ta - tb;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  if (!ranker) return chronological;

  // Stable: the chronological index is the tie-break, so equal scores and
  // unmeasured setups keep exactly the order they had above.
  return chronological
    .map((signal, index) => ({ signal, index, score: ranker(signal) }))
    .sort((a, b) => {
      if (a.score !== null && b.score !== null && a.score !== b.score) return b.score - a.score;
      if (a.score !== null && b.score === null) return -1;
      if (a.score === null && b.score !== null) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.signal);
}

/**
 * Ids of the UTC day's base-eligible graded signals that fall OUTSIDE the user's
 * cap. `frame` must be the COMPLETE set of the day's signals — a truncated
 * display window would silently change the answer, so callers use
 * `fetchDayFrame` rather than the feed's 400-row display query.
 */
export function buildCapFrame(
  frame: EligibilitySignal[],
  settings: EligibilitySettings,
  channel: EligibilityChannel,
  now: number,
  ranker?: CapRanker,
): Set<string> {
  const out = new Set<string>();
  const cap = settings.daily_setup_cap ?? 0;
  if (cap <= 0) return out;
  for (const s of capSequence(frame, settings, channel, now, ranker).slice(cap)) out.add(s.id);
  return out;
}

/** Base rules plus the cap frame. The single answer every channel uses. */
export function evaluateEligibility(args: {
  signal: EligibilitySignal;
  settings: EligibilitySettings;
  channel: EligibilityChannel;
  now: number;
  cappedOutIds: Set<string>;
}): EligibilityResult {
  const base = baseEligibility(args.signal, args.settings, args.channel, args.now);
  if (!base.eligible) return base;
  if (args.cappedOutIds.has(args.signal.id)) {
    return { eligible: false, reason: "daily_cap_reached" };
  }
  return { eligible: true, reason: "eligible" };
}

/** How many of the day's cap-consuming signals this user is eligible for. */
export function countEligibleGradedToday(
  frame: EligibilitySignal[],
  settings: EligibilitySettings,
  channel: EligibilityChannel,
  now: number,
): number {
  return capSequence(frame, settings, channel, now).length;
}
