/**
 * Broker symbol specification refresh (Prompt 12 completion patch).
 *
 * Bounded broker usage BY CONSTRUCTION and DURABLY: the attempt is claimed in
 * `spec_refresh_attempts` through a security-definer RPC *before* the broker is
 * called, so a broker error, a parse failure or a later write failure all spend
 * the same 24h budget. If the claim itself cannot be made (DB outage), we make
 * no broker request at all — fail closed rather than retry every cycle.
 *
 * This runs from its own authenticated cron (`/api/public/cron/refresh-specs`),
 * never from the 15-minute scan cron and never from a render or a user request.
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

/** One automatic attempt per symbol per 24h; the freshness bound is 36h. */
export const SPEC_REFRESH_MS = 24 * 60 * 60 * 1000;

type Db = Pick<SupabaseClient, "from" | "rpc">;

export interface RefreshOutcome {
  symbol: string;
  action: "refreshed" | "budget_exhausted" | "claim_unavailable" | "failed";
  error?: string;
}

async function claim(db: Db, symbol: string): Promise<"claimed" | "budget" | "unavailable"> {
  try {
    const { data, error } = await db.rpc("claim_spec_refresh", {
      _symbol: symbol,
      _min_interval_seconds: Math.floor(SPEC_REFRESH_MS / 1000),
    });
    if (error) return "unavailable";
    return data === true ? "claimed" : "budget";
  } catch {
    return "unavailable";
  }
}

async function recordOutcome(db: Db, symbol: string, outcome: string, error: string | null) {
  try {
    await db.rpc("record_spec_refresh_outcome", {
      _symbol: symbol,
      _outcome: outcome,
      _error: error,
    });
  } catch {
    // Observability only. The budget was already spent by the claim.
  }
}

/**
 * Refresh every symbol whose durable attempt budget allows it. Never throws.
 * Exactly zero MetaApi specification requests are issued for symbols that were
 * already attempted inside the budget window.
 */
export async function refreshSymbolSpecs(
  db: Db,
  _now = Date.now(),
  symbols: readonly string[] = INSTRUMENTS,
): Promise<RefreshOutcome[]> {
  const outcomes: RefreshOutcome[] = [];

  for (const symbol of symbols) {
    const claimed = await claim(db, symbol);
    if (claimed === "budget") {
      outcomes.push({ symbol, action: "budget_exhausted" });
      continue;
    }
    if (claimed === "unavailable") {
      outcomes.push({ symbol, action: "claim_unavailable" });
      continue;
    }

    try {
      /**
       * Brokers rename instruments. When an operator has bound this canonical
       * instrument to one exact broker ticker, the specification MUST be fetched
       * under that ticker — fetching the canonical name would either 404 or, worse,
       * answer for a different contract.
       */
      const { specFetchSymbol } = await import("@/lib/instruments/bindings.server");
      const providerSymbol = await specFetchSymbol(db as never, symbol);
      const raw = await fetchSymbolSpecification(providerSymbol);
      if (!raw) {
        outcomes.push({ symbol, action: "failed", error: "empty specification" });
        await recordOutcome(db, symbol, "failed", "empty specification");
        continue;
      }
      const row = {
        ...rowFromSpecification(symbol, raw as RawSpecification),
        provider_symbol: providerSymbol,
      };
      const { error } = await db.from("broker_symbol_specs").upsert(row, { onConflict: "symbol" });
      if (error) {
        outcomes.push({ symbol, action: "failed", error: error.message });
        await recordOutcome(db, symbol, "failed", error.message);
        continue;
      }
      outcomes.push({ symbol, action: "refreshed" });
      await recordOutcome(db, symbol, "refreshed", null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcomes.push({ symbol, action: "failed", error: message });
      await recordOutcome(db, symbol, "failed", message);
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

/** One symbol's broker spec, or null when absent/unusable. */
export async function loadBrokerSpec(db: Db, symbol: string): Promise<SizingSpec | null> {
  const { data, error } = await db
    .from("broker_symbol_specs")
    .select("*")
    .eq("symbol", symbol)
    .maybeSingle();
  if (error || !data) return null;
  return specFromRow(data as unknown as BrokerSpecRow);
}
