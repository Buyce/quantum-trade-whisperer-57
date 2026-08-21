/**
 * Basis-explicit aggregation guard.
 *
 * The original defect this whole build exists to fix was mixing units of
 * account. `mixed_basis` is therefore an AGGREGATION ERROR STATUS, never a row
 * attribute: a row holding both canonical R values is perfectly fine, but a
 * caller that tries to pool values from different bases (or pool legacy
 * provenance with canonical) gets a refusal instead of a number.
 */
import type { RBasis } from "./r-math";

export type RProvenance = "canonical" | "legacy";

export interface BasisSample {
  /** Which canonical measure this value is expressed in. */
  basis: RBasis;
  provenance: RProvenance;
  r: number;
}

export type AggregationStatus = "ok" | "mixed_basis" | "empty";

export interface BasisAggregation {
  status: AggregationStatus;
  basis: RBasis | null;
  provenance: RProvenance | null;
  n: number;
  values: number[];
  reason: string | null;
}

/**
 * Accepts samples only when every one shares the requested basis AND one
 * provenance. Anything else is refused.
 */
export function collectSingleBasis(
  samples: BasisSample[],
  requested: RBasis,
  requestedProvenance: RProvenance = "canonical",
): BasisAggregation {
  const wrongBasis = samples.filter((s) => s.basis !== requested);
  if (wrongBasis.length > 0) {
    return {
      status: "mixed_basis",
      basis: null,
      provenance: null,
      n: 0,
      values: [],
      reason: `Attempted to aggregate ${wrongBasis.length} value(s) from a different R basis than "${requested}".`,
    };
  }
  const wrongProvenance = samples.filter((s) => s.provenance !== requestedProvenance);
  if (wrongProvenance.length > 0) {
    return {
      status: "mixed_basis",
      basis: null,
      provenance: null,
      n: 0,
      values: [],
      reason: `Attempted to pool ${wrongProvenance.length} ${wrongProvenance[0]!.provenance} value(s) with ${requestedProvenance} data.`,
    };
  }
  if (samples.length === 0) {
    return {
      status: "empty",
      basis: requested,
      provenance: requestedProvenance,
      n: 0,
      values: [],
      reason: "No rows carry an R value on the requested basis.",
    };
  }
  return {
    status: "ok",
    basis: requested,
    provenance: requestedProvenance,
    n: samples.length,
    values: samples.map((s) => s.r),
    reason: null,
  };
}

/** Label shown next to any figure so the unit of account is never implied. */
export function basisLabel(basis: RBasis | null, provenance: RProvenance = "canonical"): string {
  if (provenance === "legacy") return "legacy R (frozen, mixed basis)";
  if (basis === "plan") return "R vs planned risk";
  if (basis === "actual_risk") return "R vs actual risk";
  return "R basis unavailable";
}

/** Wording for a NULL R. Never render 0.00R for a missing value. */
export const R_UNAVAILABLE_MARKER = "—";
