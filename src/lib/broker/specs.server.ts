/**
 * Broker symbol specification refresh (Prompt 12).
 *
 * Bounded broker usage by construction: at most one specification request per
 * symbol per `SPEC_REFRESH_MS`, driven from the existing scan cron and never
 * from a render, a card, or a per-user request. A failure is swallowed into a
 * boolean — the scan cycle must never fail because a spec is unavailable.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchSymbolSpecification } from "@/lib/scanner/metaapi.server";
import { INSTRUMENTS } from "@/lib/scanner/types";
import {
  rowFromSpecification,
  specFromRow,
  type BrokerSpecRow,
  type RawSpecification,
  type SizingSpec,
} from "./specs";

/** One refresh per symbol per 24h; the freshness bound in `specs.ts` is 36h. */
export const SPEC_REFRESH_MS = 24 * 60 * 60 * 1000;

type Db = Pick<SupabaseClient, "from">;

export interface RefreshOutcome {
  symbol: string;
  action: "refreshed" | "fresh" | "failed";
  error?: string;
}

/**
 * Refresh any symbol whose stored row is older than `SPEC_REFRESH_MS`.
 * Returns per-symbol outcomes for observability; never throws.
 */
export async function refreshSymbolSpecs(
  db: Db,
  now = Date.now(),
  symbols: readonly string[] = INSTRUMENTS,
): Promise<RefreshOutcome[]> {
  const outcomes: RefreshOutcome[] = [];

  let existing: Record<string, string> = {};
  try {
    const { data } = await db.from("broker_symbol_specs").select("symbol, fetched_at");
    for (const row of (data ?? []) as { symbol: string; fetched_at: string }[]) {
      existing[row.symbol] = row.fetched_at;
    }
  } catch {
    // Unknown freshness ⇒ attempt a refresh rather than skip silently.
    existing = {};
  }

  for (const symbol of symbols) {
    const fetchedAt = existing[symbol];
    if (fetchedAt && now - new Date(fetchedAt).getTime() < SPEC_REFRESH_MS) {
      outcomes.push({ symbol, action: "fresh" });
      continue;
    }
    try {
      const raw = await fetchSymbolSpecification(symbol);
      if (!raw) {
        outcomes.push({ symbol, action: "failed", error: "empty specification" });
        continue;
      }
      const row = rowFromSpecification(symbol, raw as RawSpecification);
      const { error } = await db.from("broker_symbol_specs").upsert(row, { onConflict: "symbol" });
      if (error) {
        outcomes.push({ symbol, action: "failed", error: error.message });
        continue;
      }
      outcomes.push({ symbol, action: "refreshed" });
    } catch (err) {
      outcomes.push({
        symbol,
        action: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return outcomes;
}

/**
 * Broker specs keyed by symbol, for callers that want model-2 sizing. A missing
 * or unusable row is simply absent — the caller then falls back to the labelled
 * static table rather than to a half-filled broker spec.
 */
export async function loadBrokerSpecs(db: Db): Promise<Record<string, SizingSpec>> {
  const out: Record<string, SizingSpec> = {};
  const { data, error } = await db.from("broker_symbol_specs").select("*");
  if (error || !data) return out;
  for (const row of data as unknown as BrokerSpecRow[]) {
    const spec = specFromRow(row);
    if (spec) out[spec.symbol] = spec;
  }
  return out;
}
