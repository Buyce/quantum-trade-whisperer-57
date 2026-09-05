/**
 * Adaptive spread ceilings, as pure rules.
 *
 * The owner's spread limit in pips is the absolute maximum and is never widened
 * by anything here. What this module does is TIGHTEN that limit when an
 * instrument/session is currently worse than its own recently measured normal.
 *
 * The norm comes from spread samples already collected hourly
 * (`instrument_spread_stats`, one row per instrument/session/trading day). No new
 * collection, no second source of truth.
 *
 * Invariants:
 *  - Only ever reduces the effective ceiling; never raises it above the owner's.
 *  - Too little measured history means "not measured": the owner's fixed ceiling
 *    applies unchanged. An unmeasured instrument is never treated as good OR bad.
 *  - The reduction is bounded, so an unusually quiet stretch cannot tighten a
 *    ceiling into refusing everything.
 *
 * Pure: no clock of its own, no I/O.
 */

/** Distinct trading days of history required before a norm is trusted. */
export const MIN_NORM_DAYS = 5;
/** Total valid spread samples required before a norm is trusted. */
export const MIN_NORM_SAMPLES = 40;
/**
 * How much worse than its own typical busy-end spread an instrument may be and
 * still be accepted. 1.5x the median daily p90 leaves normal variation alone.
 */
export const NORM_TOLERANCE = 1.5;
/** The effective ceiling is never tightened below this fraction of the owner's. */
export const MAX_TIGHTENING = 0.5;

export interface SpreadNormRow {
  /** One trading day's aggregate for this instrument/session. */
  tradingDate: string;
  validSamples: number;
  /** Busy-end spread for that day, in price units. */
  p90SpreadPrice: number | null;
}

export type SpreadNorm =
  | { measured: false; reason: string }
  | { measured: true; days: number; samples: number; medianP90Price: number };

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** What is this instrument/session's own normal busy-end spread? */
export function spreadNorm(rows: SpreadNormRow[]): SpreadNorm {
  const usable = rows.filter(
    (r) =>
      typeof r.p90SpreadPrice === "number" &&
      Number.isFinite(r.p90SpreadPrice) &&
      r.p90SpreadPrice > 0 &&
      Number.isFinite(r.validSamples) &&
      r.validSamples > 0,
  );
  const days = new Set(usable.map((r) => r.tradingDate)).size;
  const samples = usable.reduce((sum, r) => sum + r.validSamples, 0);
  if (days < MIN_NORM_DAYS)
    return { measured: false, reason: `only ${days} measured trading day(s) of spread history` };
  if (samples < MIN_NORM_SAMPLES)
    return { measured: false, reason: `only ${samples} valid spread samples` };
  return {
    measured: true,
    days,
    samples,
    medianP90Price: median(usable.map((r) => r.p90SpreadPrice as number)),
  };
}

export interface EffectiveSpreadCeiling {
  /** The ceiling in pips that should actually be enforced. */
  pips: number;
  /** True when the instrument's own norm tightened the owner's number. */
  tightened: boolean;
  /** Plain-language explanation, for the refusal detail and the decision log. */
  detail: string;
}

/**
 * The spread ceiling in force for this instrument/session right now.
 *
 * `ownerCeilingPips` of 0 means the owner switched the gate off; nothing here
 * switches it back on.
 */
export function effectiveSpreadCeiling(
  ownerCeilingPips: number,
  pipSize: number | null,
  norm: SpreadNorm,
): EffectiveSpreadCeiling {
  if (!(ownerCeilingPips > 0))
    return { pips: 0, tightened: false, detail: "no spread limit is set" };
  if (!norm.measured)
    return {
      pips: ownerCeilingPips,
      tightened: false,
      detail: `your ${ownerCeilingPips} pip limit applies — ${norm.reason}, so no adaptive tightening`,
    };
  if (pipSize === null || !(pipSize > 0))
    return {
      pips: ownerCeilingPips,
      tightened: false,
      detail: `your ${ownerCeilingPips} pip limit applies — no broker point size, so the norm could not be converted to pips`,
    };

  const normPips = (norm.medianP90Price / pipSize) * NORM_TOLERANCE;
  const floor = ownerCeilingPips * MAX_TIGHTENING;
  const candidate = Math.max(floor, Math.min(ownerCeilingPips, normPips));
  const pips = Math.round(candidate * 10) / 10;
  if (pips >= ownerCeilingPips)
    return {
      pips: ownerCeilingPips,
      tightened: false,
      detail: `your ${ownerCeilingPips} pip limit applies — this instrument's own normal spread is not tighter`,
    };
  return {
    pips,
    tightened: true,
    detail: `tightened to ${pips} pips from your ${ownerCeilingPips} pip limit, based on this instrument and session's own ${norm.days}-day measured spread`,
  };
}
