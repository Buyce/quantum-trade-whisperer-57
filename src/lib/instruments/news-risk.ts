/**
 * News-risk categories per instrument (Wave 2).
 *
 * The existing policy — no new trade around a high-impact event — was written with
 * FX events in mind. An oil CFD's dominant scheduled risk is the EIA inventory
 * report and an OPEC decision; an index's is US macro and earnings season. Applying
 * the FX event list to them would be a false claim of coverage.
 *
 * This module records WHICH event families matter for an instrument. It does not
 * fetch a calendar and it does not claim any event is currently scheduled: with no
 * event source configured, `newsRiskUnknown` is true and the suppression policy
 * treats the instrument as unprotected rather than as clear.
 */
import { assetClassOf } from "./registry";

export type NewsFamily =
  | "central_bank"
  | "inflation"
  | "employment"
  | "energy_inventory"
  | "opec_supply"
  | "us_macro"
  | "earnings_season";

export const NEWS_FAMILIES_BY_INSTRUMENT: Record<string, NewsFamily[]> = {
  XAUUSD: ["central_bank", "inflation", "employment"],
  XAGUSD: ["central_bank", "inflation", "employment"],
  USOIL: ["energy_inventory", "opec_supply", "us_macro"],
  UKOIL: ["energy_inventory", "opec_supply", "us_macro"],
  NAS100: ["us_macro", "central_bank", "earnings_season"],
};

/** FX pairs inherit the currency-driven families that already applied to them. */
export function newsFamiliesOf(symbol: string): NewsFamily[] {
  const explicit = NEWS_FAMILIES_BY_INSTRUMENT[symbol];
  if (explicit) return explicit;
  return assetClassOf(symbol) === "fx" ? ["central_bank", "inflation", "employment"] : [];
}

export interface NewsRiskVerdict {
  families: NewsFamily[];
  /** True when no event source can answer for these families. */
  unknown: boolean;
  /** Refuse a NEW position while true. Unknown coverage is not clearance. */
  suppressNewEntries: boolean;
  reason: string | null;
}

/**
 * Assess news risk for an instrument.
 *
 * `sourcedFamilies` is the set of families the configured event source can actually
 * answer for. Anything outside it is unknown, and unknown suppresses — the default
 * policy is "no new trade around high-impact news", and we cannot honour that for a
 * family we cannot see.
 */
export function assessNewsRisk(args: {
  symbol: string;
  sourcedFamilies?: NewsFamily[];
}): NewsRiskVerdict {
  const families = newsFamiliesOf(args.symbol);
  const sourced = new Set(args.sourcedFamilies ?? []);
  const missing = families.filter((f) => !sourced.has(f));

  if (families.length === 0) {
    return {
      families,
      unknown: true,
      suppressNewEntries: true,
      reason: `no news-risk profile is recorded for ${args.symbol}`,
    };
  }
  if (missing.length > 0) {
    return {
      families,
      unknown: true,
      suppressNewEntries: true,
      reason: `no event source covers ${missing.join(", ")} for ${args.symbol}`,
    };
  }
  return { families, unknown: false, suppressNewEntries: false, reason: null };
}
