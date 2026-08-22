/**
 * Canonical journal R mathematics. Pure, client-safe, no I/O.
 *
 * BINDING DEFINITIONS (do not alter without an explicit approved change):
 *
 *   gross_move        = long ? actual_exit - actual_entry
 *                            : actual_entry - actual_exit
 *   r_vs_plan         = gross_move / abs(planned_entry - planned_stop)
 *   stop_ref          = actual_initial_stop ?? planned_stop
 *   r_vs_actual_risk  = gross_move / abs(actual_entry - stop_ref)
 *
 * The ACTUAL FILL is always the numerator anchor for both measures. Realised
 * movement is never computed from the planned entry.
 *
 * The two values are different units of account and may coexist on one trade.
 * They must never be averaged together — see `src/lib/journal/basis.ts`.
 *
 * ZERO-HALLUCINATION: a missing input yields NULL plus an explicit availability
 * reason. Nothing is estimated, defaulted or coalesced to zero.
 */

/** Version stamp written onto every row this module computes. */
export const R_MATH_VERSION = 1;

/** Rounding used for every stored/compared R value (4 dp). */
export const R_DECIMALS = 4;

export type TradeDirection = "long" | "short";

export type StopProvenance = "actual_stop" | "planned_stop_fallback" | "unavailable";

export type RAvailability =
  | "both"
  | "plan_only"
  | "actual_risk_only"
  | "unavailable_open"
  | "unavailable_no_prices"
  | "unavailable_no_plan"
  | "unavailable_zero_risk"
  | "unavailable_no_direction";

export type RBasis = "plan" | "actual_risk";

export interface RMathInput {
  /** "open" means the trade is unresolved: no R exists yet. */
  outcome: "win" | "loss" | "breakeven" | "open";
  /**
   * NULL means the trade direction could not be established (legacy row with no
   * snapshot and no surviving signal). Direction is NEVER inferred: a null
   * direction yields NULL R with `unavailable_no_direction`.
   */
  direction: TradeDirection | null;
  /** Creation-time snapshot of the published plan. */
  plannedEntry: number | null;
  plannedStop: number | null;
  /** Real fills reported by the trader. Both or neither. */
  actualEntryPrice: number | null;
  actualExitPrice: number | null;
  /** Stop actually placed at the broker, when the trader recorded it. */
  actualInitialStop?: number | null;
}

export interface RMathResult {
  rVsPlan: number | null;
  rVsActualRisk: number | null;
  availability: RAvailability;
  stopProvenance: StopProvenance;
  /** Signed price distance from actual entry to actual exit, or null. */
  grossMove: number | null;
  /** abs(plannedEntry - plannedStop), or null. */
  plannedRisk: number | null;
  /** abs(actualEntry - stopRef), or null. */
  actualRisk: number | null;
  rMathVersion: number;
}

export class RMathInputError extends Error {
  readonly code:
    | "one_sided_prices"
    | "non_finite"
    | "non_positive_price"
    | "impossible_stop_geometry";
  constructor(code: RMathInputError["code"], message: string) {
    super(message);
    this.name = "RMathInputError";
    this.code = code;
  }
}

export function roundR(value: number): number {
  const factor = 10 ** R_DECIMALS;
  return Math.round(value * factor) / factor;
}

function isFiniteOrNull(value: number | null | undefined): boolean {
  return value == null || Number.isFinite(value);
}

/**
 * Rejects structurally impossible input rather than silently producing a
 * half-truth. One-sided prices are the important case: a resolved trade with an
 * entry but no exit (or vice versa) is a data-entry error, not a NULL R.
 */
export function assertRMathInput(input: RMathInput): void {
  for (const [name, value] of [
    ["plannedEntry", input.plannedEntry],
    ["plannedStop", input.plannedStop],
    ["actualEntryPrice", input.actualEntryPrice],
    ["actualExitPrice", input.actualExitPrice],
    ["actualInitialStop", input.actualInitialStop],
  ] as const) {
    if (!isFiniteOrNull(value)) {
      throw new RMathInputError("non_finite", `${name} must be a finite number or null`);
    }
    if (value != null && value <= 0) {
      throw new RMathInputError("non_positive_price", `${name} must be a positive price`);
    }
  }

  const hasEntry = input.actualEntryPrice != null;
  const hasExit = input.actualExitPrice != null;
  if (hasEntry !== hasExit) {
    throw new RMathInputError(
      "one_sided_prices",
      "actual entry and exit prices must be supplied together or not at all",
    );
  }

  // Actual-stop geometry. A long's protective stop sits BELOW its fill and a
  // short's sits ABOVE it. Wrong-side or zero-distance stops are impossible, so
  // they are rejected outright rather than turned into a plausible-looking
  // r_vs_actual_risk by an abs().
  const entry = input.actualEntryPrice;
  const stop = input.actualInitialStop;
  if (entry != null && stop != null && input.direction != null) {
    const distance = entry - stop;
    if (!Number.isFinite(distance) || distance === 0) {
      throw new RMathInputError(
        "impossible_stop_geometry",
        "actual initial stop must be a finite, non-zero distance from the actual entry",
      );
    }
    if (input.direction === "long" && stop >= entry) {
      throw new RMathInputError(
        "impossible_stop_geometry",
        "a long trade's actual initial stop must be below its actual entry",
      );
    }
    if (input.direction === "short" && stop <= entry) {
      throw new RMathInputError(
        "impossible_stop_geometry",
        "a short trade's actual initial stop must be above its actual entry",
      );
    }
  }
}

/** Computes both canonical R values. Never throws for merely-missing inputs. */
export function computeR(input: RMathInput): RMathResult {
  assertRMathInput(input);

  const base: RMathResult = {
    rVsPlan: null,
    rVsActualRisk: null,
    availability: "unavailable_no_prices",
    stopProvenance: "unavailable",
    grossMove: null,
    plannedRisk: null,
    actualRisk: null,
    rMathVersion: R_MATH_VERSION,
  };

  if (input.outcome === "open") {
    return { ...base, availability: "unavailable_open" };
  }

  // Fail closed: without a known direction there is no signed gross move, so no
  // canonical R can exist. Nothing is assumed to be long.
  if (input.direction == null) {
    return { ...base, availability: "unavailable_no_direction" };
  }

  const entry = input.actualEntryPrice;
  const exit = input.actualExitPrice;
  if (entry == null || exit == null) {
    return { ...base, availability: "unavailable_no_prices" };
  }

  // Actual fill is the numerator anchor for BOTH measures.
  const grossMove = input.direction === "long" ? exit - entry : entry - exit;

  const plannedRisk =
    input.plannedEntry != null && input.plannedStop != null
      ? Math.abs(input.plannedEntry - input.plannedStop)
      : null;

  const actualStop = input.actualInitialStop ?? null;
  const stopRef = actualStop ?? input.plannedStop ?? null;
  const stopProvenance: StopProvenance =
    actualStop != null
      ? "actual_stop"
      : input.plannedStop != null
        ? "planned_stop_fallback"
        : "unavailable";
  const actualRisk = stopRef != null ? Math.abs(entry - stopRef) : null;

  const rVsPlan = plannedRisk != null && plannedRisk > 0 ? roundR(grossMove / plannedRisk) : null;
  const rVsActualRisk =
    actualRisk != null && actualRisk > 0 ? roundR(grossMove / actualRisk) : null;

  let availability: RAvailability;
  if (rVsPlan != null && rVsActualRisk != null) availability = "both";
  else if (rVsPlan != null) availability = "plan_only";
  else if (rVsActualRisk != null) availability = "actual_risk_only";
  else if (plannedRisk === null && stopRef === null) availability = "unavailable_no_plan";
  else availability = "unavailable_zero_risk";

  return {
    rVsPlan,
    rVsActualRisk,
    availability,
    stopProvenance,
    grossMove,
    plannedRisk,
    actualRisk,
    rMathVersion: R_MATH_VERSION,
  };
}

/** Picks the value for one explicitly requested basis. Never falls back. */
export function selectR(
  row: { r_vs_plan: number | null; r_vs_actual_risk: number | null },
  basis: RBasis,
): number | null {
  const raw = basis === "plan" ? row.r_vs_plan : row.r_vs_actual_risk;
  return raw == null ? null : Number(raw);
}

/* ------------------------------------------------------------------ costs */

export type CostUnit = "account_currency" | "instrument_quote" | "points" | "unknown";

export interface CostInput {
  commission: number | null;
  swap: number | null;
  costCurrency: string | null;
  costUnit: CostUnit | null;
  /**
   * Documented monetary value of 1R for this trade. Only a recorded, auditable
   * conversion counts — never an inferred one.
   */
  documentedRValueInCostCurrency?: number | null;
}

export type NetRStatus =
  | "no_costs_recorded"
  | "no_conversion_provenance"
  | "computed"
  | "unavailable_gross";

export interface NetRResult {
  netR: number | null;
  status: NetRStatus;
  /** Human-readable, safe to render. Never claims a cost-adjusted figure. */
  note: string;
}

/**
 * Monetary costs are NOT price distances. They only become R when a documented
 * conversion exists; otherwise net R is explicitly unavailable.
 */
export function computeNetR(grossR: number | null, costs: CostInput): NetRResult {
  if (grossR == null) {
    return {
      netR: null,
      status: "unavailable_gross",
      note: "Gross R is unavailable, so net R cannot exist.",
    };
  }
  const commission = costs.commission ?? 0;
  const swap = costs.swap ?? 0;
  const total = commission + swap;
  if (costs.commission == null && costs.swap == null) {
    return {
      netR: null,
      status: "no_costs_recorded",
      note: "No commission or swap recorded. Gross R only.",
    };
  }
  const rValue = costs.documentedRValueInCostCurrency ?? null;
  if (rValue == null || !Number.isFinite(rValue) || rValue <= 0) {
    return {
      netR: null,
      status: "no_conversion_provenance",
      note: "Costs are recorded in money with no documented conversion to R. Gross R only.",
    };
  }
  return {
    netR: roundR(grossR - total / rValue),
    status: "computed",
    note: "Net R uses the documented monetary value of 1R for this trade.",
  };
}
