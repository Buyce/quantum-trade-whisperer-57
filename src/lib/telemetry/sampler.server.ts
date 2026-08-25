/**
 * Bounded spread sampler runtime (Phase A2 operational telemetry).
 *
 * WHAT IT IS: one quote per authorised instrument per scheduled 15-minute slot,
 * classified and stored as evidence. Nothing else.
 *
 * WHAT IT IS NOT: it does not grade, publish, alert, enqueue, size, resolve or
 * touch a statistic. It cannot promote an instrument. It cannot influence Wave 0
 * behaviour in any way, because nothing it writes is read by the live pipeline.
 *
 * COST IS BOUNDED BY CONSTRUCTION, IN THIS ORDER:
 *   1. the kill switch (`telemetry_controls.sampler_enabled`) — fail-closed;
 *   2. the slot claim (`claim_sampler_slot`) — exactly one run per UTC slot per
 *      sampler version, so a duplicated schedule tick cannot double-spend;
 *   3. the per-run instrument and request ceilings, floored by the compiled
 *      constants so a settings edit cannot raise them;
 *   4. per-instrument stage and breaker checks, read fresh, before any request.
 *
 * SAMPLING IS SIDE-EFFECT-FREE COLLECTION. It is explicitly allowed for a
 * `data_validation` instrument: that is the whole point of the stage. It is
 * refused for `disabled` and `suspended`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadBrokerSpec } from "@/lib/broker/specs.server";
import { resolveFetchSymbol } from "@/lib/instruments/fetch-authority.server";
import { LIVE_CANDLE_POLICY_VERSION } from "@/lib/instruments/candle-policy";
import { isWeekendClosed } from "@/lib/market-hours";
import { fetchQuoteFor } from "@/lib/metaapi/market.server";
import { withBenchmarkAccount } from "@/lib/metaapi/benchmark.server";
import { scannerSessionOf } from "@/lib/market-hours";
import { SESSION_VERSION } from "@/lib/scanner/session";

import { assetClassOf } from "@/lib/instruments/registry";
import { calendarForAssetClass, calendarUsable } from "@/lib/instruments/calendars";

import { readTelemetryControls } from "./controls.server";
import {
  ATR_SNAPSHOT_MAX_AGE_MS,
  SAMPLER_VERSION,
  alignSlot,
  classifyQuote,
  spreadMetrics,
} from "./sampler";

/** Stages a side-effect-free measurement may be taken in. */
const SAMPLEABLE_STAGES = new Set([
  "data_validation",
  "shadow",
  "signals_only",
  "execution_approved",
]);

export interface SamplerOutcome {
  ran: boolean;
  reason?: "disabled" | "no_symbols" | "slot_already_claimed" | "controls_unreadable";
  runId?: string;
  scheduledAt?: string;
  expected?: string[];
  attempted?: string[];
  succeeded?: string[];
  invalidSamples?: number;
  failedRequests?: number;
  stageSkipped?: string[];
  breakerSkipped?: string[];
  mappingRefused?: { instrument: string; refusal: string }[];
  requestCount?: number;
  durationMs?: number;
}

interface SpecFacts {
  point: number | null;
  digits: number | null;
  tickSize: number | null;
  specAsOf: string | null;
}

async function specFacts(db: SupabaseClient, symbol: string): Promise<SpecFacts> {
  const spec = await loadBrokerSpec(db, symbol);
  let specAsOf: string | null = null;
  try {
    const { data } = await db
      .from("broker_symbol_specs")
      .select("fetched_at")
      .eq("symbol", symbol)
      .maybeSingle();
    specAsOf = (data as { fetched_at?: string } | null)?.fetched_at ?? null;
  } catch {
    specAsOf = null;
  }
  return {
    point: spec?.point ?? null,
    digits: spec?.digits ?? null,
    tickSize: spec?.tickSize ?? null,
    specAsOf,
  };
}

/** Latest ATR snapshot young enough to describe present volatility, else null. */
async function recentAtr(
  db: SupabaseClient,
  instrument: string,
  now: Date,
): Promise<{ id: number; atr: number } | null> {
  const { data, error } = await db
    .from("instrument_atr_snapshots")
    .select("id, atr, created_at")
    .eq("instrument", instrument)
    .eq("timeframe", "H1")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const row = data[0] as { id: number; atr: number | string; created_at: string };
  const age = now.getTime() - Date.parse(row.created_at);
  if (!Number.isFinite(age) || age > ATR_SNAPSHOT_MAX_AGE_MS) return null;
  const atr = Number(row.atr);
  return Number.isFinite(atr) && atr > 0 ? { id: row.id, atr } : null;
}

async function stageOf(db: SupabaseClient, symbol: string): Promise<string | null> {
  const { data, error } = await db
    .from("instrument_lifecycle")
    .select("stage")
    .eq("symbol", symbol)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { stage: string }).stage;
}

async function breakerOpen(db: SupabaseClient, symbol: string, now: Date): Promise<boolean> {
  const { data, error } = await db
    .from("instrument_health")
    .select("available, unavailable_until")
    .eq("instrument", symbol)
    .maybeSingle();
  if (error || !data) return false;
  const row = data as { available: boolean | null; unavailable_until: string | null };
  if (row.available === false) {
    if (!row.unavailable_until) return true;
    return Date.parse(row.unavailable_until) > now.getTime();
  }
  return false;
}

/**
 * Run one sampling slot. Returns a description of what happened; it never throws
 * for an ordinary provider or stage refusal, because a refusal IS the result.
 */
export async function runSpreadSampler(db: SupabaseClient, now = new Date()): Promise<SamplerOutcome> {
  const startedAt = Date.now();
  const controls = await readTelemetryControls(db);
  if (controls.degraded) return { ran: false, reason: "controls_unreadable" };
  if (!controls.samplerEnabled) return { ran: false, reason: "disabled" };

  const expected = controls.samplerSymbols.slice(0, Math.max(0, controls.maxInstrumentsPerRun));
  if (expected.length === 0) return { ran: false, reason: "no_symbols" };

  const scheduledAt = alignSlot(now);
  const { data: claimed, error: claimError } = await db.rpc("claim_sampler_slot", {
    _scheduled_at: scheduledAt.toISOString(),
    _sampler_version: SAMPLER_VERSION,
    _expected: expected,
  });
  if (claimError || !claimed) {
    return { ran: false, reason: "slot_already_claimed", scheduledAt: scheduledAt.toISOString() };
  }
  const runId = String(claimed);

  const attempted: string[] = [];
  const succeeded: string[] = [];
  const stageSkipped: string[] = [];
  const breakerSkipped: string[] = [];
  const mappingRefused: { instrument: string; refusal: string }[] = [];
  const calendarRefused: { instrument: string; refusal: string }[] = [];
  let invalidSamples = 0;
  let failedRequests = 0;
  let requestCount = 0;
  let providerOutage = false;
  let errorClass: string | null = null;
  const marketClosed = isWeekendClosed(now);
  const session = scannerSessionOf(now);

  for (const instrument of expected) {
    if (requestCount >= controls.maxRequestsPerRun) break;

    const stage = await stageOf(db, instrument);
    // A missing or unreadable stage is refused, not assumed permissive.
    if (!stage || !SAMPLEABLE_STAGES.has(stage)) {
      stageSkipped.push(instrument);
      continue;
    }
    if (await breakerOpen(db, instrument, now)) {
      breakerSkipped.push(instrument);
      continue;
    }

    // Wave 2: an instrument may only be measured against a calendar whose
    // boundaries were sourced, not approximated. Energy and index CFDs have
    // venue-local sessions, so they are refused here until those boundaries exist.
    const assetClass = assetClassOf(instrument);
    const cal = assetClass ? calendarForAssetClass(assetClass) : undefined;
    const usable = cal ? calendarUsable(cal) : { usable: false, reason: "no market calendar" };
    if (!usable.usable) {
      calendarRefused.push({ instrument, refusal: usable.reason ?? "calendar unusable" });
      continue;
    }

    const authority = await resolveFetchSymbol(db, instrument, { now });
    if (!authority.usable || !authority.providerSymbol) {
      mappingRefused.push({ instrument, refusal: authority.refusal ?? "unusable_mapping" });
      continue;
    }

    const facts = await specFacts(db, instrument);
    const atr = await recentAtr(db, instrument, now);

    attempted.push(instrument);
    let quote: Awaited<ReturnType<typeof fetchQuoteFor>> = null;
    try {
      requestCount += 1;
      quote = await withBenchmarkAccount(({ accountId, region }) =>
        fetchQuoteFor(accountId, region, authority.providerSymbol as string),
      );
    } catch (err) {
      failedRequests += 1;
      providerOutage = true;
      errorClass = err instanceof Error ? err.name : "provider_error";
      continue;
    }

    const classification = classifyQuote({
      bid: quote?.bid ?? null,
      ask: quote?.ask ?? null,
      sourceTime: quote?.sourceTime ?? null,
      now,
      marketClosed,
    });

    const metrics =
      classification.quality === "valid" && quote
        ? spreadMetrics({
            bid: quote.bid,
            ask: quote.ask,
            point: facts.point,
            digits: facts.digits,
            assetClass,
            atr: atr?.atr ?? null,
          })
        : null;

    const { error: insertError } = await db.from("instrument_spread_samples").insert({
      run_id: runId,
      instrument,
      asset_class: assetClass,
      provider_symbol: authority.providerSymbol,
      scope: "scanner",
      stage,
      bid: quote?.bid ?? null,
      ask: quote?.ask ?? null,
      mid: metrics?.mid ?? null,
      spread_price: metrics?.spreadPrice ?? null,
      spread_points: metrics?.spreadPoints ?? null,
      spread_pips: metrics?.spreadPips ?? null,
      digits: facts.digits,
      point: facts.point,
      tick_size: facts.tickSize,
      atr_snapshot_id: atr?.id ?? null,
      spread_atr_fraction: metrics?.spreadAtrFraction ?? null,
      session,
      session_version: SESSION_VERSION,
      source_time: quote?.sourceTime ?? null,
      received_at: quote?.receivedAt ?? now.toISOString(),
      mapping_verified_at: authority.mapping.verifiedAt,
      spec_as_of: facts.specAsOf,
      market_state: classification.marketState,
      quality: classification.quality,
      quality_reasons: classification.reasons,
      sampler_version: SAMPLER_VERSION,
      candle_policy_version: LIVE_CANDLE_POLICY_VERSION,
    });

    if (insertError) {
      failedRequests += 1;
      errorClass = errorClass ?? "db_write_failed";
      continue;
    }

    if (classification.quality === "valid") succeeded.push(instrument);
    else invalidSamples += 1;
  }

  const durationMs = Date.now() - startedAt;
  await db
    .from("spread_sampler_runs")
    .update({
      finished_at: new Date().toISOString(),
      attempted_instruments: attempted,
      succeeded_instruments: succeeded,
      invalid_samples: invalidSamples,
      failed_requests: failedRequests,
      stage_skipped: stageSkipped,
      breaker_skipped: breakerSkipped,
      provider_outage: providerOutage,
      request_count: requestCount,
      duration_ms: durationMs,
      error_class: errorClass,
    })
    .eq("run_id", runId);

  return {
    ran: true,
    runId,
    scheduledAt: scheduledAt.toISOString(),
    expected,
    attempted,
    succeeded,
    invalidSamples,
    failedRequests,
    stageSkipped,
    breakerSkipped,
    mappingRefused,
    requestCount,
    durationMs,
  };
}
