/**
 * Prompt 14 Stage 5 — Risk Guardian, as pure rules.
 *
 * Risk Guardian is drawdown OBSERVATION supplied by the broker-side vendor API.
 * Two honesty rules shape this module:
 *
 *  1. Where the vendor cannot watch the account — MT5 NETTING accounts are the
 *     verified case — we say so, with the reason, and create no tracker. A
 *     tracker that is not watching anything is worse than no tracker.
 *  2. A breach is an OBSERVATION with a time, not a verdict on the trader. It may
 *     influence EXECUTION only (a refusal to add exposure). It may never touch
 *     the scanner, the research population or any published statistic.
 *
 * Pure: no fetch, no clock beyond values passed in.
 */

export type TrackerPeriod = "day" | "month";

export interface TrackerPlan {
  key: string;
  name: string;
  period: TrackerPeriod;
  /** Relative drawdown threshold as a fraction (0.05 = 5%). */
  relativeDrawdownThreshold: number;
}

/** Operator-configured defaults. Thresholds are configuration, not guesses. */
export const DEFAULT_TRACKER_PLANS: TrackerPlan[] = [
  { key: "daily", name: "P-Trades daily drawdown", period: "day", relativeDrawdownThreshold: 0.05 },
  {
    key: "monthly",
    name: "P-Trades monthly drawdown",
    period: "month",
    relativeDrawdownThreshold: 0.1,
  },
];

export interface GuardianState {
  available: boolean;
  reason: string | null;
  trackers: { key: string; vendorId: string | null; lastError: string | null }[];
}

/** Copy for the account page. Never implies watching when it is not. */
export function describeGuardian(state: GuardianState): string {
  if (!state.available) {
    return `Risk Guardian is unavailable for this account. ${state.reason ?? ""}`.trim();
  }
  const live = state.trackers.filter((t) => t.vendorId).length;
  if (live === 0) return "Risk Guardian is available, but no drawdown tracker exists yet.";
  return `Risk Guardian is watching ${live} drawdown threshold${live === 1 ? "" : "s"} at your broker.`;
}

export interface RawTrackerEvent {
  id?: unknown;
  trackerId?: unknown;
  sequenceNumber?: unknown;
  startBrokerTime?: unknown;
  endBrokerTime?: unknown;
  brokerTime?: unknown;
  absoluteDrawdown?: unknown;
  relativeDrawdown?: unknown;
  [key: string]: unknown;
}

export interface NormalisedTrackerEvent {
  /** Stable fingerprint so the same broker event is never stored twice. */
  fingerprint: string;
  eventAt: string | null;
  absoluteDrawdown: number | null;
  relativeDrawdown: number | null;
  payload: Record<string, unknown>;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function normaliseTrackerEvent(raw: RawTrackerEvent): NormalisedTrackerEvent {
  const at = str(raw.endBrokerTime) ?? str(raw.brokerTime) ?? str(raw.startBrokerTime);
  const parsed = at ? Date.parse(at.replace(" ", "T") + (at.endsWith("Z") ? "" : "Z")) : NaN;
  const fingerprint = [
    str(raw.id) ?? "",
    str(raw.trackerId) ?? "",
    raw.sequenceNumber === undefined ? "" : String(raw.sequenceNumber),
    at ?? "",
  ].join("|");
  return {
    fingerprint,
    eventAt: Number.isFinite(parsed) ? new Date(parsed).toISOString() : null,
    absoluteDrawdown: num(raw.absoluteDrawdown),
    relativeDrawdown: num(raw.relativeDrawdown),
    payload: raw as Record<string, unknown>,
  };
}

/**
 * What a Risk Guardian breach is allowed to affect. Greppable and tested, so the
 * boundary cannot erode by accident.
 */
export const GUARDIAN_INFLUENCES = Object.freeze({
  execution: true,
  display: true,
  scanner: false,
  research: false,
  grading: false,
  publishedStatistics: false,
});
