/**
 * Promotion checkpoint — the PURE evidence gate for
 * `data_validation -> shadow`.
 *
 * Readiness says "the provider can serve this instrument right now".
 * Commissioning says "collection may start". Neither of them says an instrument
 * has been OBSERVED long enough to be measured against the strategy. That is
 * this module's only job, and it is deliberately arithmetic:
 *
 *   - enough distinct real trading days of valid spread samples;
 *   - samples in every session the instrument is scanned in;
 *   - missingness at or below a stated ceiling;
 *   - the latest readiness snapshot ready, with BOTH the conversion route and the
 *     live conversion data proven;
 *   - a provider symbol that was verified and did not change during the window;
 *   - a spread-floor candidate derived from real samples.
 *
 * FAIL CLOSED. Absent evidence is never treated as satisfied evidence: no rows
 * means blocked, an unreadable stage means blocked, a missing readiness snapshot
 * means blocked.
 *
 * This module PROMOTES NOTHING. It returns a verdict an operator attaches to the
 * existing audited `transition_instrument_stage` decision.
 */
import type { InstrumentStage } from "./lifecycle";

/** Distinct UTC trading days of valid samples required before measurement. */
export const REQUIRED_TRADING_DAYS = 5;

/** Highest tolerated share of sampler attempts that produced no usable tick. */
export const MAX_MISSINGNESS_PCT = 20;

/** Minimum valid samples overall — days alone can hide a nearly empty day. */
export const REQUIRED_VALID_SAMPLES = 200;

/** A readiness snapshot older than this is not current evidence. */
export const READINESS_MAX_AGE_HOURS = 24;

export type PromotionBlocker =
  | "not_in_data_validation"
  | "stage_unreadable"
  | "no_spread_evidence"
  | "insufficient_trading_days"
  | "insufficient_valid_samples"
  | "sessions_not_covered"
  | "missingness_too_high"
  | "no_readiness_snapshot"
  | "readiness_stale"
  | "readiness_failed"
  | "conversion_route_unproven"
  | "conversion_data_unproven"
  | "provider_symbol_unverified"
  | "provider_symbol_changed"
  | "no_spread_floor_candidate";

export interface PromotionEvidence {
  instrument: string;
  /** Lifecycle stage as read; null when it could not be read at all. */
  stage: InstrumentStage | null;
  /** Distinct UTC dates that produced at least one VALID sample. */
  tradingDays: number;
  /** Valid samples across the whole window. */
  validSamples: number;
  /** Samples the sampler rejected as unusable. */
  invalidSamples: number;
  /** Sessions this instrument is scanned in. */
  expectedSessions: string[];
  /** Sessions that actually produced a valid sample. */
  coveredSessions: string[];
  /** Share of attempts with no usable tick, or null when not measurable. */
  missingnessPct: number | null;
  /** Latest readiness snapshot, null when none exists in the window. */
  readiness: {
    ready: boolean;
    checkedAt: string;
    conversionRouteReady: boolean;
    conversionDataReady: boolean;
    providerSymbol: string | null;
    failedChecks: string[];
  } | null;
  /** Provider symbol proven by the mapping authority, null when it refused. */
  mappedProviderSymbol: string | null;
  /** Distinct provider symbols observed across the sample window. */
  observedProviderSymbols: string[];
  /** Spread-floor candidate derived from real samples, null when unmeasured. */
  spreadFloorCandidate: number | null;
}

export interface PromotionVerdict {
  instrument: string;
  promotable: boolean;
  blockers: PromotionBlocker[];
  /** Human sentence per blocker, with the measured value beside the threshold. */
  reasons: string[];
  evidence: PromotionEvidence;
}

function ageHours(checkedAt: string, now: number): number | null {
  const parsed = Date.parse(checkedAt);
  return Number.isFinite(parsed) ? (now - parsed) / 3_600_000 : null;
}

export function evaluatePromotion(evidence: PromotionEvidence, now = Date.now()): PromotionVerdict {
  const blockers: PromotionBlocker[] = [];
  const reasons: string[] = [];
  const block = (blocker: PromotionBlocker, reason: string) => {
    blockers.push(blocker);
    reasons.push(reason);
  };

  if (evidence.stage === null) {
    block("stage_unreadable", "the lifecycle stage could not be read, so nothing is claimed");
  } else if (evidence.stage !== "data_validation") {
    block(
      "not_in_data_validation",
      `this checkpoint only judges instruments at data_validation; this one is at "${evidence.stage}"`,
    );
  }

  if (evidence.validSamples === 0) {
    block("no_spread_evidence", "no valid spread samples have been recorded");
  } else {
    if (evidence.tradingDays < REQUIRED_TRADING_DAYS) {
      block(
        "insufficient_trading_days",
        `${evidence.tradingDays} distinct trading day(s) of valid samples, ${REQUIRED_TRADING_DAYS} required`,
      );
    }
    if (evidence.validSamples < REQUIRED_VALID_SAMPLES) {
      block(
        "insufficient_valid_samples",
        `${evidence.validSamples} valid samples, ${REQUIRED_VALID_SAMPLES} required`,
      );
    }
  }

  const missingSessions = evidence.expectedSessions.filter(
    (s) => !evidence.coveredSessions.includes(s),
  );
  if (missingSessions.length > 0) {
    block(
      "sessions_not_covered",
      `no valid samples yet in ${missingSessions.join(", ")}`,
    );
  }

  if (evidence.missingnessPct === null) {
    block("missingness_too_high", "sample missingness could not be measured");
  } else if (evidence.missingnessPct > MAX_MISSINGNESS_PCT) {
    block(
      "missingness_too_high",
      `${evidence.missingnessPct.toFixed(1)}% of sampler attempts produced no usable tick, ceiling ${MAX_MISSINGNESS_PCT}%`,
    );
  }

  const readiness = evidence.readiness;
  if (!readiness) {
    block("no_readiness_snapshot", "no readiness snapshot exists for this instrument");
  } else {
    const age = ageHours(readiness.checkedAt, now);
    if (age === null || age > READINESS_MAX_AGE_HOURS) {
      block(
        "readiness_stale",
        `the newest readiness snapshot is ${age === null ? "undated" : `${age.toFixed(1)}h old`}, limit ${READINESS_MAX_AGE_HOURS}h`,
      );
    }
    if (!readiness.ready) {
      block(
        "readiness_failed",
        `the newest readiness check failed on: ${readiness.failedChecks.join(", ") || "unknown"}`,
      );
    }
    if (!readiness.conversionRouteReady) {
      block("conversion_route_unproven", "no conversion route for every supported account currency");
    }
    if (!readiness.conversionDataReady) {
      block(
        "conversion_data_unproven",
        "the broker did not quote every conversion leg the routes need",
      );
    }
  }

  if (!evidence.mappedProviderSymbol) {
    block("provider_symbol_unverified", "the mapping authority did not prove a provider symbol");
  } else {
    const drifted = evidence.observedProviderSymbols.filter(
      (s) => s !== evidence.mappedProviderSymbol,
    );
    if (drifted.length > 0) {
      block(
        "provider_symbol_changed",
        `samples were collected under ${drifted.join(", ")} but the mapping now resolves to ${evidence.mappedProviderSymbol}`,
      );
    }
  }

  if (evidence.spreadFloorCandidate === null || !(evidence.spreadFloorCandidate > 0)) {
    block("no_spread_floor_candidate", "no spread floor could be derived from real samples");
  }

  return {
    instrument: evidence.instrument,
    promotable: blockers.length === 0,
    blockers,
    reasons,
    evidence,
  };
}
