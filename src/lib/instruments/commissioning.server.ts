/**
 * Commissioning runtime — the evidence pass that must precede any
 * `disabled -> data_validation` transition.
 *
 * For one instrument it, in order:
 *   1. discovers the exact provider symbol from the broker inventory (ambiguous
 *      aliases are refused, never chosen between) and RECORDS the discovery;
 *   2. refreshes the provider specification under that exact name;
 *   3. runs the full readiness check and persists an immutable snapshot;
 *   4. reads the per-instrument breaker and the sampler capacity headroom;
 *   5. returns a pure commissioning decision.
 *
 * It NEVER transitions a stage, enables a flag, publishes, alerts or submits an
 * order. Everything it writes is evidence.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { evaluateCommissioning, type CommissioningDecision } from "./commissioning";
import { instrumentDefinition } from "./registry";

export interface CommissioningRunResult {
  decision: CommissioningDecision;
  /** Provider requests this instrument's pass consumed, for quota accounting. */
  requestCount: number;
  /** Discovery outcome recorded in `instrument_alias_discovery`. */
  discoveryOutcome: string | null;
  /** Specification refresh action, e.g. `refreshed` or `budget_exhausted`. */
  specAction: string | null;
  /** True when a readiness snapshot row was written. */
  snapshotWritten: boolean;
  error: string | null;
}

async function breakerOpenFor(db: SupabaseClient, symbol: string): Promise<boolean> {
  const { data } = await db
    .from("instrument_health")
    .select("available, breaker_open_until, unavailable_until")
    .eq("instrument", symbol)
    .maybeSingle();
  const row = data as {
    available?: boolean;
    breaker_open_until?: string | null;
    unavailable_until?: string | null;
  } | null;
  if (!row) return false;
  const now = Date.now();
  const open = (at?: string | null) => Boolean(at && new Date(at).getTime() > now);
  return open(row.breaker_open_until) || open(row.unavailable_until) || row.available === false;
}

/**
 * Sampler slots left if this instrument were added.
 *
 * `max_instruments_per_run` is the hard ceiling the sampler already enforces, so
 * headroom is that ceiling minus the instruments already authorised. Zero
 * headroom is a real blocker: adding a symbol the sampler will silently drop
 * would produce an instrument at `data_validation` that collects nothing.
 */
async function capacityHeadroom(db: SupabaseClient, symbol: string): Promise<number> {
  const { data } = await db
    .from("telemetry_controls")
    .select("sampler_symbols, max_instruments_per_run")
    .eq("id", true)
    .maybeSingle();
  const row = data as { sampler_symbols?: string[]; max_instruments_per_run?: number } | null;
  if (!row) return 0;
  const authorised = Array.isArray(row.sampler_symbols) ? row.sampler_symbols : [];
  const ceiling = Number(row.max_instruments_per_run ?? 0);
  if (authorised.includes(symbol)) return Math.max(0, ceiling - authorised.length + 1);
  return ceiling - authorised.length;
}

export async function runCommissioningPass(
  db: SupabaseClient,
  symbol: string,
  inventory: string[] | null,
): Promise<CommissioningRunResult> {
  const definition = instrumentDefinition(symbol);
  if (!definition) {
    return {
      decision: evaluateCommissioning({
        symbol,
        providerSymbol: null,
        mappingStatus: null,
        specPresent: false,
        specFields: {},
        candlesOk: false,
        quoteOk: false,
        conversionOk: false,
        spreadFloorCandidate: null,
        calendarSource: null,
        breakerOpen: false,
        capacityHeadroom: 0,
      }),
      requestCount: 0,
      discoveryOutcome: null,
      specAction: null,
      snapshotWritten: false,
      error: null,
    };
  }

  const { discoverAlias } = await import("./discovery.server");
  const { refreshSymbolSpecs } = await import("@/lib/broker/specs.server");
  const { snapshotInstrumentReadiness } = await import("./readiness-snapshot.server");
  const { fetchQuote } = await import("@/lib/metaapi/market.server");

  let requestCount = 0;
  let discoveryOutcome: string | null = null;
  let specAction: string | null = null;

  try {
    // 1. Exact provider symbol, refusing ambiguity.
    if (inventory && inventory.length > 0) {
      const discovery = await discoverAlias(db, definition.symbol, inventory);
      discoveryOutcome = discovery.outcome;
      requestCount += 1;
    }

    // 2. Provider specification under the canonical name (budgeted per symbol).
    const specOutcomes = await refreshSymbolSpecs(db, Date.now(), [definition.symbol]);
    specAction = specOutcomes[0]?.action ?? null;
    if (specAction === "refreshed" || specAction === "failed") requestCount += 1;

    // 3. Full readiness + persisted snapshot (this is the provider-heavy step).
    const snapshot = await snapshotInstrumentReadiness(db, definition.symbol, fetchQuote);
    requestCount += 3 + 1 + snapshot.requestCount;

    // The snapshot result does not carry the per-check detail, so re-read the
    // report fields from the row we just wrote rather than re-fetching.
    const { data: latest } = await db
      .from("instrument_readiness_snapshots")
      .select("checks, mapping, spec_fields, spread_floor_candidate, provider_symbol")
      .eq("instrument", definition.symbol)
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = (latest ?? {}) as {
      checks?: { name: string; ok: boolean }[];
      mapping?: { status?: string | null };
      spec_fields?: Record<string, boolean>;
      spread_floor_candidate?: number | null;
      provider_symbol?: string | null;
    };
    const checkOk = (name: string) => Boolean(row.checks?.find((c) => c.name === name)?.ok);

    const { data: specRow } = await db
      .from("broker_symbol_specs")
      .select("symbol")
      .eq("symbol", definition.symbol)
      .maybeSingle();
    const { data: calendarRow } = await db
      .from("instrument_calendar_bindings")
      .select("source")
      .eq("symbol", definition.symbol)
      .maybeSingle();

    const decision = evaluateCommissioning({
      symbol: definition.symbol,
      providerSymbol: row.provider_symbol ?? snapshot.providerSymbol ?? null,
      mappingStatus: row.mapping?.status ?? null,
      specPresent: Boolean(specRow),
      specFields: row.spec_fields ?? {},
      candlesOk: checkOk("candles"),
      quoteOk: checkOk("quote"),
      conversionOk: snapshot.conversionRouteReady && snapshot.conversionDataReady,
      spreadFloorCandidate: row.spread_floor_candidate ?? null,
      calendarSource: (calendarRow as { source?: string } | null)?.source ?? null,
      breakerOpen: await breakerOpenFor(db, definition.symbol),
      capacityHeadroom: await capacityHeadroom(db, definition.symbol),
    });

    return {
      decision,
      requestCount,
      discoveryOutcome,
      specAction,
      snapshotWritten: snapshot.snapshotWritten,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      decision: evaluateCommissioning({
        symbol: definition.symbol,
        providerSymbol: null,
        mappingStatus: null,
        specPresent: false,
        specFields: {},
        candlesOk: false,
        quoteOk: false,
        conversionOk: false,
        spreadFloorCandidate: null,
        calendarSource: null,
        breakerOpen: false,
        capacityHeadroom: 0,
      }),
      requestCount,
      discoveryOutcome,
      specAction,
      snapshotWritten: false,
      error: message,
    };
  }
}

export type { CommissioningDecision };
