/**
 * Price units per asset class (Wave 2).
 *
 * THE RULE THIS MODULE EXISTS TO KILL: "one pip is ten points".
 *
 * That is an FX decimal convention. It is meaningless for an index CFD, wrong for
 * an energy CFD quoted in cents, and misleading for silver. Wave 0 lived with the
 * shortcut because gold's own pip claim was never used for a decision; a
 * multi-asset platform cannot.
 *
 * So: a distance is reported in the unit the instrument actually has, and the
 * conversion authority is the BROKER's `point`/`tickSize`, never a decimal guess.
 * When the broker unit is unknown the answer is `null` — a refusal, not a default.
 */
import { assetClassOf, priceUnitOf, type AssetClass, type PriceUnit } from "./registry";

export interface UnitInput {
  symbol: string;
  /** Broker SYMBOL_POINT. Null means unknown, NOT 1. */
  point: number | null;
  /** Broker tick size when it differs from point (indices often do). */
  tickSize?: number | null;
  /** Broker digits. Only ever used to decide the FX pip factor. */
  digits: number | null;
}

export interface DistanceReport {
  assetClass: AssetClass | null;
  unit: PriceUnit | null;
  /** Always available: the raw quote-currency distance. */
  price: number;
  /** Broker points. Null when the broker point is unknown. */
  points: number | null;
  /** Ticks on the broker's execution grid. Null when the grid is unknown. */
  ticks: number | null;
  /** FX pips. NULL for every non-FX instrument, by construction. */
  pips: number | null;
  /** Index points. NULL for everything that is not an index. */
  indexPoints: number | null;
  /** Why a unit is null, for logging and for telemetry rows. */
  refusals: string[];
}

/**
 * The FX pip factor, and ONLY for FX.
 *
 * 3 or 5 digits → a pip is ten points. 2 or 4 digits → a pip is one point.
 * Anything else, or a non-FX instrument, has no pip at all.
 */
export function fxPipSize(input: UnitInput): number | null {
  if (assetClassOf(input.symbol) !== "fx") return null;
  const point = input.point && input.point > 0 ? input.point : null;
  if (!point) return null;
  if (input.digits === 3 || input.digits === 5) return point * 10;
  if (input.digits === 2 || input.digits === 4) return point;
  return null;
}

function round(value: number, precision = 6): number {
  return Number(value.toPrecision(precision));
}

/** Report one absolute price distance in every unit that is honestly available. */
export function describeDistance(distance: number, input: UnitInput): DistanceReport {
  const assetClass = assetClassOf(input.symbol);
  const unit = priceUnitOf(input.symbol);
  const refusals: string[] = [];

  const point = input.point && input.point > 0 ? input.point : null;
  const tick = input.tickSize && input.tickSize > 0 ? input.tickSize : point;
  if (!point) refusals.push("broker point unknown");
  if (!tick) refusals.push("broker execution grid unknown");
  if (assetClass === null) refusals.push("symbol is not in the instrument registry");

  const pipSize = fxPipSize(input);
  if (assetClass === "fx" && pipSize === null) refusals.push("fx pip size undetermined");

  return {
    assetClass,
    unit,
    price: round(distance),
    points: point ? round(distance / point) : null,
    ticks: tick ? round(distance / tick) : null,
    pips: pipSize ? round(distance / pipSize) : null,
    indexPoints: assetClass === "index" ? round(distance) : null,
    refusals,
  };
}

/**
 * Monetary value of one tick for one lot.
 *
 * Requires the broker's contract size AND grid. Both are broker facts; when
 * either is missing this returns null and the caller must refuse to size.
 */
export function tickValue(args: {
  contractSize: number | null;
  tickSize: number | null;
}): number | null {
  const { contractSize, tickSize } = args;
  if (!contractSize || contractSize <= 0) return null;
  if (!tickSize || tickSize <= 0) return null;
  return round(contractSize * tickSize);
}

/** Spread relative to volatility — the only cross-asset comparable cost figure. */
export function spreadToAtr(spreadPrice: number, atr: number | null): number | null {
  if (!atr || atr <= 0 || !Number.isFinite(spreadPrice)) return null;
  return Number((spreadPrice / atr).toPrecision(5));
}

/** Human label for a unit, used in diagnostics copy. */
export function unitLabel(unit: PriceUnit | null): string {
  switch (unit) {
    case "pip":
      return "pips";
    case "price":
      return "price units";
    case "index_point":
      return "index points";
    default:
      return "unknown unit";
  }
}
