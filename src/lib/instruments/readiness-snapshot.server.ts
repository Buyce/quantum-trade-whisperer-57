/**
 * Readiness snapshots with LIVE conversion proof (R5).
 *
 * `checkInstrumentReadiness` answers whether a conversion ROUTE exists — a
 * structural fact about currency pairs. That is necessary but not sufficient: a
 * route through USDJPY is worthless if the broker will not quote USDJPY right now.
 * Sizing that cannot obtain a rate must refuse, so readiness has to distinguish:
 *
 *   conversion_route_ready      — a route exists for every supported account currency
 *   conversion_data_ready       — the broker actually quoted every leg those routes need
 *   execution_conversion_ready  — both, i.e. risk in this instrument's quote currency
 *                                 can be expressed in every supported account currency
 *                                 with live numbers, not with an assumption
 *
 * Cost control: legs are de-duplicated across account currencies before any quote
 * is requested, so proving four account currencies costs at most a handful of
 * requests, and zero when the routes are all parity.
 *
 * This writes a snapshot. It never changes a stage, a flag or a capability.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { planConversion } from "@/lib/mcp/fx";
import { instrumentDefinition } from "./registry";
import { checkInstrumentReadiness, SUPPORTED_ACCOUNT_CURRENCIES } from "./readiness.server";
import { resolveFetchSymbol } from "./fetch-authority.server";
import { LIVE_CANDLE_POLICY_VERSION } from "./candle-policy";
import { fetchUsableQuote } from "./quote-retry";

export interface ConversionProof {
  accountCurrency: string;
  route: string;
  legs: string[];
  /** Legs the broker would not quote. Empty when every leg was obtained. */
  missingLegs: string[];
  ok: boolean;
}

export interface ReadinessSnapshotResult {
  instrument: string;
  ready: boolean;
  providerSymbol: string | null;
  conversionRouteReady: boolean;
  conversionDataReady: boolean;
  executionConversionReady: boolean;
  conversionProof: ConversionProof[];
  requestCount: number;
  snapshotWritten: boolean;
}

type QuoteFetcher = (symbol: string) => Promise<{ bid: number; ask: number } | null>;

/**
 * Prove conversion with live quotes. Returns one entry per supported account
 * currency plus the number of provider requests actually spent.
 */
export async function proveConversion(
  quoteCurrency: string,
  fetchQuote: QuoteFetcher,
): Promise<{ proof: ConversionProof[]; requestCount: number }> {
  const plans = SUPPORTED_ACCOUNT_CURRENCIES.map((accountCurrency) => ({
    accountCurrency,
    plan: planConversion(quoteCurrency, accountCurrency),
  }));

  // De-duplicate legs BEFORE spending anything.
  const legs = new Set<string>();
  for (const { plan } of plans) for (const symbol of plan.symbols) legs.add(symbol);

  const obtained = new Map<string, boolean>();
  let requestCount = 0;
  for (const leg of legs) {
    // Bounded re-quote: one failed or malformed leg fetch must not be recorded as
    // "the broker will not quote this leg" (production saw exactly that on
    // USDCHF, whose neighbouring snapshots quoted the same leg fine).
    const outcome = await fetchUsableQuote(leg, fetchQuote);
    requestCount += outcome.attempts;
    obtained.set(leg, outcome.quote !== null);
  }

  const proof: ConversionProof[] = plans.map(({ accountCurrency, plan }) => {
    const missingLegs = plan.symbols.filter((s) => obtained.get(s) !== true);
    return {
      accountCurrency,
      route: plan.kind,
      legs: [...plan.symbols],
      missingLegs,
      ok: plan.kind !== "unsupported" && missingLegs.length === 0,
    };
  });

  return { proof, requestCount };
}

/**
 * Run readiness for one instrument and persist it as an immutable snapshot,
 * including the provider symbol used and the candle policy in force.
 */
export async function snapshotInstrumentReadiness(
  db: SupabaseClient,
  instrument: string,
  fetchQuote: QuoteFetcher,
): Promise<ReadinessSnapshotResult> {
  const report = await checkInstrumentReadiness(db, instrument);
  const definition = instrumentDefinition(instrument);
  const authority = await resolveFetchSymbol(db, instrument);

  const conversionRouteReady = report.conversion.every((c) => c.ok);
  const { proof, requestCount } = definition
    ? await proveConversion(definition.quote, fetchQuote)
    : { proof: [] as ConversionProof[], requestCount: 0 };

  const conversionDataReady = proof.length > 0 && proof.every((p) => p.missingLegs.length === 0);
  const executionConversionReady = conversionRouteReady && conversionDataReady;

  const { error } = await db.from("instrument_readiness_snapshots").insert({
    instrument,
    ready: report.ready,
    checks: report.checks,
    mapping: report.mapping ?? {},
    spec_fields: report.specFields,
    series: report.series,
    conversion: report.conversion,
    spread_floor_candidate: report.spreadFloorCandidate,
    checked_at: report.checkedAt,
    conversion_live: proof,
    conversion_route_ready: conversionRouteReady,
    conversion_data_ready: conversionDataReady,
    execution_conversion_ready: executionConversionReady,
    provider_symbol: authority.providerSymbol,
    candle_policy_version: LIVE_CANDLE_POLICY_VERSION,
  });

  return {
    instrument,
    ready: report.ready,
    providerSymbol: authority.providerSymbol,
    conversionRouteReady,
    conversionDataReady,
    executionConversionReady,
    conversionProof: proof,
    requestCount,
    snapshotWritten: !error,
  };
}
