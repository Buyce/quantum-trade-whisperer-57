/**
 * Provider-symbol fetch authority (R8).
 *
 * A canonical P-Trades instrument name ("XAUUSD") is NOT a broker symbol. Brokers
 * append suffixes, rename metals and occasionally quote the same economic pair
 * under two tickers. Every historical bug in this area had the same shape: code
 * passed the canonical name straight to the provider and the provider answered
 * for *something*, so nobody noticed.
 *
 * From here on, any read that will be stored as evidence must resolve the provider
 * symbol through the mapping authority FIRST and refuse when the mapping is
 * unusable. Refusing is the correct outcome — an unmapped symbol has no honest
 * measurement, and a defaulted one is a fabricated measurement.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveMapping, type MappingResolution } from "./mapping.server";

export interface FetchAuthority {
  canonical: string;
  /** Provider symbol to send, or null when the read must not happen. */
  providerSymbol: string | null;
  usable: boolean;
  mapping: MappingResolution;
  /** Human-readable reason a read was refused; null when usable. */
  refusal: string | null;
}

/**
 * Resolve the broker symbol for a scanner-scope read (the benchmark feed).
 * `accountId` narrows the scope when the read is for one connected account.
 */
export async function resolveFetchSymbol(
  db: SupabaseClient,
  canonical: string,
  options?: { accountId?: string | null; now?: Date },
): Promise<FetchAuthority> {
  const mapping = await resolveMapping(db, {
    canonical,
    accountId: options?.accountId ?? null,
    now: options?.now ?? new Date(),
  });

  const usable = mapping.usable && typeof mapping.providerSymbol === "string";
  return {
    canonical,
    providerSymbol: usable ? mapping.providerSymbol : null,
    usable,
    mapping,
    refusal: usable ? null : `${mapping.refusal ?? "unusable_mapping"}: ${mapping.detail}`,
  };
}
