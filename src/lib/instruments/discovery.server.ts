/**
 * Broker alias discovery (Wave 2) — EVIDENCE ONLY, never a mapping.
 *
 * "XAGUSD", "USOIL", "UKOIL" and "NAS100" are P-Trades names. A broker may expose
 * silver as `XAGUSD.r`, WTI as `USOIL`, `WTI`, `CL-OIL` or `XTIUSD`, Brent as
 * `UKOIL` or `XBRUSD`, and the tech index as `NAS100`, `US100`, `USTECH` or
 * `NDX100`. Guessing is how a system ends up measuring the wrong instrument and
 * never noticing.
 *
 * So this module ASKS the provider what it actually has, records what it saw, and
 * refuses to conclude anything when the answer is not unambiguous. It writes rows to
 * `instrument_alias_discovery`. It NEVER writes `broker_symbol_specs`,
 * `connected_account_symbols` or any mapping table, so running it cannot enable an
 * instrument.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { withBenchmarkAccount } from "@/lib/metaapi/benchmark.server";
import { fetchSymbols, fetchTypedSymbolSpecification } from "@/lib/metaapi/specs.server";

import { assetClassOf, instrumentDefinition } from "./registry";

export type DiscoveryOutcome =
  "candidate" | "ambiguous" | "missing" | "spec_unusable" | "trade_mode_unusable" | "error";

export interface DiscoveryResult {
  canonical: string;
  outcome: DiscoveryOutcome;
  providerSymbol: string | null;
  candidates: string[];
  reason: string | null;
  evidence: Record<string, unknown> | null;
}

/**
 * Naming patterns we are willing to CONSIDER, per canonical name.
 *
 * A pattern only decides what to look at. It never decides correctness: a match
 * still has to produce a usable specification and an unambiguous single result.
 */
const CANDIDATE_PATTERNS: Record<string, RegExp[]> = {
  XAGUSD: [/^XAGUSD/i, /^SILVER/i],
  USOIL: [/^USOIL/i, /^XTIUSD/i, /^WTI/i, /^CL[-_.]?OIL/i, /^CRUDE/i],
  UKOIL: [/^UKOIL/i, /^XBRUSD/i, /^BRENT/i],
  NAS100: [/^NAS100/i, /^US100/i, /^USTEC/i, /^NDX100/i, /^NASDAQ/i],
};

/** Suffix noise a broker adds to the same economic instrument (`.r`, `-ECN`, `m`). */
const SUFFIX = /([.\-_](?:r|raw|ecn|pro|std|c|m|cash)|m|c)$/i;

function normalise(symbol: string): string {
  return symbol.replace(SUFFIX, "").toUpperCase();
}

export function proposeCandidates(canonical: string, inventory: string[]): string[] {
  const patterns = CANDIDATE_PATTERNS[canonical];
  if (!patterns) return [];
  const hits = inventory.filter((s) => patterns.some((p) => p.test(s)));
  // Two provider tickers that normalise to the SAME root are one instrument with
  // broker suffix noise; two different roots are genuine ambiguity.
  const roots = new Set(hits.map(normalise));
  return roots.size <= 1 ? hits.slice(0, 1) : hits;
}

interface SpecView {
  digits?: unknown;
  point?: unknown;
  tickSize?: unknown;
  contractSize?: unknown;
  minVolume?: unknown;
  volumeStep?: unknown;
  tradeMode?: unknown;
  quoteCurrency?: unknown;
  profitCurrency?: unknown;
  baseCurrency?: unknown;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Everything sizing and precision need, checked field by field. A specification
 * that is missing any of them is `spec_unusable` — partial broker geometry is not
 * geometry.
 */
export function evaluateSpec(
  canonical: string,
  spec: SpecView | null,
): {
  ok: boolean;
  outcome: DiscoveryOutcome;
  reason: string | null;
  fields: Record<string, boolean>;
} {
  if (!spec) {
    return {
      ok: false,
      outcome: "spec_unusable",
      reason: "the broker returned no specification",
      fields: {},
    };
  }
  const fields = {
    digits: typeof spec.digits === "number" && Number.isInteger(spec.digits) && spec.digits >= 0,
    point: num(spec.point) !== null,
    tickSize: num(spec.tickSize) !== null || num(spec.point) !== null,
    contractSize: num(spec.contractSize) !== null,
    minVolume: num(spec.minVolume) !== null,
    volumeStep: num(spec.volumeStep) !== null,
  };
  const missing = Object.entries(fields)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  if (missing.length) {
    return {
      ok: false,
      outcome: "spec_unusable",
      reason: `specification is missing ${missing.join(", ")}`,
      fields,
    };
  }

  const tradeMode = typeof spec.tradeMode === "string" ? spec.tradeMode.toUpperCase() : null;
  if (tradeMode && (tradeMode.includes("DISABLED") || tradeMode.includes("CLOSE_ONLY"))) {
    return {
      ok: false,
      outcome: "trade_mode_unusable",
      reason: `broker trade mode is ${tradeMode}`,
      fields,
    };
  }

  // The settlement currency must match the route conversion was planned for.
  const expected = instrumentDefinition(canonical)?.quote ?? null;
  const actual =
    (typeof spec.profitCurrency === "string" && spec.profitCurrency) ||
    (typeof spec.quoteCurrency === "string" && spec.quoteCurrency) ||
    null;
  if (expected && actual && actual.toUpperCase() !== expected.toUpperCase()) {
    return {
      ok: false,
      outcome: "spec_unusable",
      reason: `broker settles ${canonical} in ${actual}, the registry planned conversion for ${expected}`,
      fields,
    };
  }

  return { ok: true, outcome: "candidate", reason: null, fields };
}

/**
 * Discover, classify and RECORD. One instrument per call, bounded to at most one
 * inventory read (shared by the caller) plus one specification read.
 */
export async function discoverAlias(
  db: SupabaseClient,
  canonical: string,
  inventory: string[],
): Promise<DiscoveryResult> {
  const assetClass = assetClassOf(canonical) ?? "fx";
  const candidates = proposeCandidates(canonical, inventory);

  const record = async (result: DiscoveryResult): Promise<DiscoveryResult> => {
    try {
      await db.from("instrument_alias_discovery").insert({
        canonical,
        asset_class: assetClass,
        outcome: result.outcome,
        provider_symbol: result.providerSymbol,
        candidates: result.candidates,
        reason: result.reason,
        evidence: result.evidence as never,
      });
    } catch {
      // Recording is diagnostic; a failed write must not become a false conclusion.
    }
    return result;
  };

  if (candidates.length === 0) {
    return record({
      canonical,
      outcome: "missing",
      providerSymbol: null,
      candidates,
      reason: "the broker inventory contains no symbol matching any accepted pattern",
      evidence: { inventorySize: inventory.length },
    });
  }
  if (candidates.length > 1) {
    return record({
      canonical,
      outcome: "ambiguous",
      providerSymbol: null,
      candidates,
      reason: `the broker exposes ${candidates.length} distinct instruments matching ${canonical}; an operator must choose`,
      evidence: { inventorySize: inventory.length },
    });
  }

  const providerSymbol = candidates[0]!;
  try {
    const spec = await withBenchmarkAccount(({ accountId, region }) =>
      fetchTypedSymbolSpecification(accountId, region, providerSymbol),
    );
    const verdict = evaluateSpec(canonical, spec as SpecView | null);
    return record({
      canonical,
      outcome: verdict.outcome,
      providerSymbol: verdict.ok ? providerSymbol : null,
      candidates,
      reason: verdict.reason,
      evidence: { providerSymbol, fields: verdict.fields },
    });
  } catch (err) {
    return record({
      canonical,
      outcome: "error",
      providerSymbol: null,
      candidates,
      reason: err instanceof Error ? err.message : String(err),
      evidence: { providerSymbol },
    });
  }
}

/** Fetch the broker inventory once, for a whole discovery pass. */
export async function fetchInventory(): Promise<string[]> {
  const symbols = await withBenchmarkAccount(({ accountId, region }) =>
    fetchSymbols(accountId, region),
  );
  return symbols ?? [];
}
