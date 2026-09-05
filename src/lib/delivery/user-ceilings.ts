/**
 * Owner-configured execution ceilings: spread, slippage and total exposure.
 *
 * These are USER limits, not engine constants. The engine's own spread rule
 * (`spreadAcceptable`, a fraction of planned risk) is unchanged and still runs;
 * these gates are asked in addition to it, and whichever refuses first wins.
 *
 * Pure: no fetch, no clock, no database. Every number that comes in is either
 * broker-derived (bid, ask, point, digits, equity) or owner-configured. Nothing
 * here invents a value: when the pip size or the equity is unknown, the caller
 * is told "unknown" and decides, and a configured ceiling that cannot be
 * measured refuses rather than silently passing.
 */

export interface CeilingSettings {
  /** Max acceptable spread at entry, in pips. 0 (or absent) disables the gate. */
  maxEntrySpreadPips: number;
  /** Max tolerated deviation from the published entry, in pips. 0 disables. */
  maxEntrySlippagePips: number;
  /** Ceiling on total open + resting risk as a percent of equity. 0 disables. */
  maxTotalExposurePercent: number;
  /** Only when true does the exposure percent ceiling refuse; otherwise advisory. */
  exposureCeilingEnforced: boolean;
}

const clampPips = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, 10_000);
};

const clampPercent = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, 100);
};

export function readCeilingSettings(row: {
  max_entry_spread_pips?: number | null;
  max_entry_slippage_pips?: number | null;
  max_total_exposure_percent?: number | null;
  exposure_limit_enabled?: boolean | null;
}): CeilingSettings {
  return {
    maxEntrySpreadPips: clampPips(row.max_entry_spread_pips),
    maxEntrySlippagePips: clampPips(row.max_entry_slippage_pips),
    maxTotalExposurePercent: clampPercent(row.max_total_exposure_percent),
    exposureCeilingEnforced: row.exposure_limit_enabled === true,
  };
}

/**
 * Price value of one pip, from the broker's own point/digits.
 *
 * A pip is ten points on a 3- or 5-digit quote and one point everywhere else.
 * Returns null when the broker published neither a point nor a digit count —
 * a pip size is never guessed from the instrument name.
 */
export function pipSizeFromSpec(
  spec: { point?: number | null; digits?: number | null } | null,
): number | null {
  if (!spec) return null;
  const digits =
    typeof spec.digits === "number" && Number.isInteger(spec.digits) && spec.digits >= 0
      ? spec.digits
      : null;
  let point: number | null =
    typeof spec.point === "number" && Number.isFinite(spec.point) && spec.point > 0
      ? spec.point
      : null;
  if (point === null && digits !== null) point = Math.pow(10, -digits);
  if (point === null) return null;
  const fractional = digits === 3 || digits === 5;
  return fractional ? point * 10 : point;
}

export type CeilingVerdict = { ok: true; measured: number | null } | { ok: false; detail: string };

/** Is the live spread inside the owner's pip ceiling? */
export function spreadWithinUserCeiling(
  ceilingPips: number,
  pipSize: number | null,
  bid: number,
  ask: number,
): CeilingVerdict {
  if (ceilingPips <= 0) return { ok: true, measured: null };
  if (pipSize === null || !(pipSize > 0)) {
    return {
      ok: false,
      detail:
        "your broker has not published a point size for this symbol, so your spread limit in pips could not be measured",
    };
  }
  if (!(bid > 0) || !(ask > 0) || ask < bid) {
    return { ok: false, detail: "the broker quote was not usable for a spread measurement" };
  }
  const spreadPips = (ask - bid) / pipSize;
  if (spreadPips > ceilingPips) {
    return {
      ok: false,
      detail: `spread ${spreadPips.toFixed(1)} pips is above your ${ceilingPips} pip limit`,
    };
  }
  return { ok: true, measured: spreadPips };
}

/** Is the price we would actually trade at inside the owner's slippage ceiling? */
export function slippageWithinUserCeiling(
  ceilingPips: number,
  pipSize: number | null,
  publishedEntry: number,
  executionPrice: number,
): CeilingVerdict {
  if (ceilingPips <= 0) return { ok: true, measured: null };
  if (pipSize === null || !(pipSize > 0)) {
    return {
      ok: false,
      detail:
        "your broker has not published a point size for this symbol, so your slippage limit in pips could not be measured",
    };
  }
  if (!(publishedEntry > 0) || !(executionPrice > 0)) {
    return { ok: false, detail: "no usable price pair for a slippage measurement" };
  }
  const slipPips = Math.abs(executionPrice - publishedEntry) / pipSize;
  if (slipPips > ceilingPips) {
    return {
      ok: false,
      detail: `price is ${slipPips.toFixed(1)} pips from the published entry, above your ${ceilingPips} pip limit`,
    };
  }
  return { ok: true, measured: slipPips };
}

export interface ExposureAccumulation {
  /** Sum of risk percent already committed by open/resting P-Trades orders. */
  knownPercent: number;
  /** How many active orders carry no recorded risk figure (never assumed zero). */
  unknownOrders: number;
}

export type ExposurePercentVerdict =
  | { ok: true; totalPercent: number; incomplete: boolean; detail: string | null }
  | { ok: false; detail: string };

/**
 * Would this order push total committed risk past the owner's percent ceiling?
 *
 * Orders whose risk figure was never recorded are reported, never estimated: the
 * total is then "at least" the known sum, and the message says so.
 */
export function exposurePercentWithinCeiling(
  ceilingPercent: number,
  enforced: boolean,
  accumulated: ExposureAccumulation,
  incomingPercent: number | null,
): ExposurePercentVerdict {
  if (ceilingPercent <= 0) return { ok: true, totalPercent: 0, incomplete: false, detail: null };
  if (incomingPercent === null || !Number.isFinite(incomingPercent)) {
    return {
      ok: false,
      detail:
        "the risk of this order as a percent of your broker equity could not be established, so your total-exposure limit could not be checked",
    };
  }
  const known = Number.isFinite(accumulated.knownPercent)
    ? Math.max(0, accumulated.knownPercent)
    : 0;
  const total = known + Math.max(0, incomingPercent);
  const incomplete = accumulated.unknownOrders > 0;
  const suffix = incomplete
    ? ` (${accumulated.unknownOrders} earlier order${accumulated.unknownOrders === 1 ? "" : "s"} carr${accumulated.unknownOrders === 1 ? "ies" : "y"} no recorded risk figure, so the real total is at least this)`
    : "";
  if (total > ceilingPercent) {
    const detail = `this order would take your open + resting P-Trades risk to ${total.toFixed(2)}% of equity, above your ${ceilingPercent}% limit${suffix}`;
    return enforced ? { ok: false, detail } : { ok: true, totalPercent: total, incomplete, detail };
  }
  return { ok: true, totalPercent: total, incomplete, detail: null };
}
