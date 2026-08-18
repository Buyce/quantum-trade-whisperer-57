/**
 * Server-side read path for the regime statistics.
 *
 * The table is one row per (tier, key) — roughly 100 rows even at 10k resolved
 * shadow executions — so one unfiltered select per scan job is cheaper than any
 * per-key round trip, and the live feed never touches this path at all.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { lookupRegime, type RegimePrior, type RegimeQuery, type RegimeStatRow } from "./regime";

export async function loadRegimeStats(db: SupabaseClient): Promise<RegimeStatRow[]> {
  const { data, error } = await db
    .from("regime_stats")
    .select(
      "tier, regime_key, instrument, direction, session, vol_bucket, n_total, n_filled, wins, p_fill_shrunk, p_win_shrunk, vol_t1, vol_t2",
    );
  if (error) throw new Error(`regime_stats read failed: ${error.message}`);
  return (data ?? []) as RegimeStatRow[];
}

/**
 * Resolve the advisory prior for one setup. Returns null when the statistics
 * table is empty or unreadable — the scanner then publishes with null priors
 * rather than a fabricated probability.
 */
export async function priorFor(
  db: SupabaseClient,
  query: RegimeQuery,
): Promise<RegimePrior | null> {
  try {
    const rows = await loadRegimeStats(db);
    return lookupRegime(rows, query);
  } catch {
    return null;
  }
}
