/**
 * The coverage scopes the ingestion run is asked to answer for.
 *
 * Derived from the instrument registry rather than hand-listed, so adding an
 * instrument automatically widens the honesty requirement instead of silently
 * inheriting another instrument's coverage.
 */
import { REGISTRY_SYMBOLS } from "@/lib/instruments/registry";

import type { CoverageScope } from "./coverage";
import { requiredCoverageFor } from "./identity";

export function scopesForSymbols(symbols: readonly string[]): CoverageScope[] {
  const seen = new Set<string>();
  const out: CoverageScope[] = [];
  for (const symbol of symbols) {
    const { currencies, families } = requiredCoverageFor(symbol);
    for (const currency of currencies) {
      for (const family of families) {
        const key = `${currency}|${family}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ currency, family });
      }
    }
  }
  return out;
}

/** Every scope the whole registry needs. */
export function allRegistryScopes(): CoverageScope[] {
  return scopesForSymbols(REGISTRY_SYMBOLS);
}
