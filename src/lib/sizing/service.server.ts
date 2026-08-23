/**
 * THE shared sizing service (Prompt 12 completion patch).
 *
 * Single entry point for every sizing answer P-Trades gives — the terminal's
 * risk panel and the MCP `calculate_position_size` tool both call this, so a
 * user and their agent can never be told different lot sizes or different
 * provenance.
 *
 * It: loads the broker specification, decides spec freshness, obtains only the
 * FX legs actually required (with source timestamps), runs the dual model, keeps
 * MODEL 1 (static contract table) authoritative unless an admin/service-role
 * promotion flag is set, records divergences, and returns explicit provenance.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RISK_UNAVAILABLE_COPY,
  money,
  riskProfileFromSettings,
  type RiskProfile,
  type RiskUnavailableReason,
} from "@/lib/risk";
import { isSpecStale, staticSpec, type SizingSpec } from "@/lib/broker/specs";
import { loadBrokerSpec } from "@/lib/broker/specs.server";
import { resolveSizing } from "@/lib/broker/sizing.server";
import { resolveConversion, QUOTE_MAX_AGE_MS } from "./conversion.server";
import { portfolioAdvisory, type AdvisoryTradeRow, type PortfolioAdvisory } from "./portfolio";

type Db = Pick<SupabaseClient, "from" | "rpc">;

export interface SizingRequest {
  instrument: string;
  entryPrice: number;
  stopLoss: number;
  finalTargetR?: number | null;
  signalId?: string | null;
}

export interface SizingProvenance {
  authoritativeModel: 1 | 2;
  /** A usable broker spec exists for the model-2 shadow run. */
  shadowAvailable: boolean;
  /**
   * Provenance of the AUTHORITATIVE model only. While model 1 is authoritative
   * this is always `static_v1`, even when a broker spec exists for the shadow.
   */
  specSource: "broker" | "static_v1";
  specAsOf: string | null;
  /** Shadow (model-2) provenance, reported separately and never conflated. */
  shadowSpecSource: "broker" | "static_v1";
  shadowSpecAsOf: string | null;
  specStale: boolean;
  quoteAsOf: string | null;
  quoteStale: boolean;
  quoteMaxAgeMs: number;
  conversionRoute: string;
  conversionRequests: number;
  marginBasis: "notional_over_leverage";
  marginNote: string;
  /**
   * `user_entered` = the equity the trader typed into settings.
   * `broker_reported` = equity read from the destination broker account
   * (connected-account execution sizing).
   */
  equityBasis: "user_entered" | "broker_reported";
  equityAsOf: string | null;
  /** Present only for connected-account sizing. */
  accountId?: string | null;
}

export interface SizingUnavailable {
  available: false;
  reason: RiskUnavailableReason;
  explanation: string;
  provenance: SizingProvenance;
  profile: RiskProfile;
  advisory: PortfolioAdvisory | null;
}

export interface SizingAvailable {
  available: true;
  instrument: string;
  entryPrice: number;
  stopLoss: number;
  currency: string;
  quoteCurrency: string;
  conversionRate: number;
  lots: number;
  rawLots: number;
  riskAmount: number;
  riskBudget: number;
  riskPercentOfEquity: number;
  riskPerLot: number;
  stopDistance: number;
  stopPercent: number;
  notional: number;
  marginEstimate: number;
  marginPercentOfEquity: number;
  rewardAtFinalTarget: number | null;
  finalTargetR: number | null;
  minStopDistance: number | null;
  brokerVolumeCap: number | null;
  cappedByBrokerVolume: boolean;
  cappedByPositionSize: boolean;
  belowMinimumLot: boolean;
  exceedsMargin: boolean;
  exceedsStopCeiling: boolean;
  guardrails: string[];
  provenance: SizingProvenance;
  profile: RiskProfile;
  advisory: PortfolioAdvisory | null;
}

export type SizingResponse = SizingAvailable | SizingUnavailable;

/** Service-role-only promotion flag. Never exposed to users or agents. */
async function sizingV2Enabled(): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("shadow_engine_state")
      .select("sizing_v2_enabled")
      .maybeSingle();
    return (data as { sizing_v2_enabled?: boolean } | null)?.sizing_v2_enabled === true;
  } catch {
    // Unknown promotion state must never promote: model 1 stays authoritative.
    return false;
  }
}

interface DivergenceRow {
  instrument: string;
  signal_id: string | null;
  user_id: string | null;
  authoritative_model: number;
  spec_source: string;
  v1_lots: number | null;
  v2_lots: number | null;
  v1_reason: string | null;
  v2_reason: string | null;
  lots_delta: number | null;
  risk_delta: number | null;
  summary: string;
}

async function logDivergence(row: DivergenceRow): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("sizing_divergence_log").insert(row);
  } catch (err) {
    // An unrecorded divergence must never deny a user their sizing.
    console.error("[sizing] divergence log failed", err);
  }
}

function guardrailsFor(
  r: Extract<ReturnType<typeof resolveSizing>["authoritative"], { ok: true }>,
  profile: RiskProfile,
): string[] {
  const cur = r.currency;
  const out: string[] = [];
  if (r.belowMinimumLot)
    out.push(
      `Your ${money(r.riskBudget, cur)} risk budget is below the minimum tradable lot for this stop distance. Sizing down is not possible — skipping is the only way to respect your limit.`,
    );
  if (r.cappedByPositionSize)
    out.push(
      `Size limited by your ${profile.maxPositionSize}-lot ceiling, so you are risking ${money(r.riskAmount, cur)} instead of the full ${money(r.riskBudget, cur)}.`,
    );
  if (r.cappedByBrokerVolume)
    out.push(
      `Size limited by the broker's volume ceiling of ${r.brokerVolumeCap} lots for this symbol.`,
    );
  if (r.exceedsMargin)
    out.push(
      `Estimated margin of ${money(r.marginEstimate, cur)} at 1:${profile.leverage} exceeds your entered equity — this size is likely not fundable. This is an estimate (notional ÷ leverage), not your broker's requirement.`,
    );
  if (r.exceedsStopCeiling)
    out.push(
      `Stop is ${r.stopPercent.toFixed(2)}% from entry, wider than your ${profile.maxStopLossPercent}% ceiling.`,
    );
  return out;
}

/**
 * Overrides used by connected-account (direct broker) sizing.
 *
 * The trader's own risk PERCENT still applies — it is their limit — but the
 * equity, the account currency and the contract specification all come from the
 * destination broker account, because that is the account the order lands in.
 */
export interface AccountSizingOverride {
  accountId: string;
  /** Broker-reported equity. Null is not accepted by the caller. */
  equity: number;
  currency: string;
  /** When the broker reported that equity. */
  equityAsOf: string | null;
  /** The account's own contract specification, or null when unavailable. */
  spec: SizingSpec | null;
}

/**
 * Resolve sizing for one setup for one user. `db` must be an authenticated,
 * user-scoped client: settings and journal rows are read under RLS as the user.
 */
export async function resolveSizingForUser(
  db: Db,
  userId: string,
  request: SizingRequest,
  now = Date.now(),
  override?: AccountSizingOverride,
): Promise<SizingResponse> {
  const { data: settings } = await db
    .from("scanner_settings")
    .select(
      "account_equity, account_currency, risk_per_trade_percent, max_position_size, leverage, max_stop_loss_percent, equity_as_of",
    )
    .eq("user_id", userId)
    .maybeSingle();
  const baseProfile = riskProfileFromSettings(settings as Record<string, unknown> | null);
  const profile: RiskProfile = override
    ? { ...baseProfile, accountEquity: override.equity, accountCurrency: override.currency }
    : baseProfile;
  const equityAsOf = override
    ? override.equityAsOf
    : (((settings as { equity_as_of?: string | null } | null)?.equity_as_of ?? null) as
        | string
        | null);

  // Advisory exposure from the user's own journal. Never blocks sizing.
  let advisory: PortfolioAdvisory | null = null;
  try {
    const { data: trades } = await db
      .from("executed_trades")
      .select(
        "outcome, trade_state, actual_entry_at, actual_exit_at, updated_at, signal_instrument, r_vs_plan",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500);
    advisory = portfolioAdvisory((trades ?? []) as AdvisoryTradeRow[], profile, new Date(now));
  } catch {
    advisory = null;
  }

  // Connected-account sizing uses THAT account's specification; nothing else
  // may substitute for it, so an absent account spec is not backfilled from the
  // benchmark table.
  const brokerSpec: SizingSpec | null = override
    ? override.spec
    : await loadBrokerSpec(db, request.instrument);
  const specStale = brokerSpec ? isSpecStale(brokerSpec, now) : false;

  const quoteCurrency =
    brokerSpec?.quote ?? staticSpec(request.instrument)?.quote ?? request.instrument.slice(3);
  const { fetchQuote } = await import("@/lib/scanner/metaapi.server");
  const conversion = await resolveConversion(
    quoteCurrency,
    profile.accountCurrency,
    fetchQuote,
    now,
  );

  const resolved = resolveSizing(
    {
      instrument: request.instrument,
      entryPrice: request.entryPrice,
      stopLoss: request.stopLoss,
      finalTargetR: request.finalTargetR ?? null,
    },
    profile,
    conversion.rates,
    {
      spec: brokerSpec,
      v2Promoted: await sizingV2Enabled(),
      quoteStale: conversion.stale,
      now,
    },
  );

  if (resolved.divergence.diverged) {
    await logDivergence({
      instrument: request.instrument,
      signal_id: request.signalId ?? null,
      user_id: userId,
      authoritative_model: resolved.authoritativeModel,
      spec_source: brokerSpec ? "broker" : "static_v1",
      v1_lots: resolved.divergence.v1Lots,
      v2_lots: resolved.divergence.v2Lots,
      v1_reason: resolved.divergence.v1Reason,
      v2_reason: resolved.divergence.v2Reason,
      lots_delta: resolved.divergence.lotsDelta,
      risk_delta: resolved.divergence.riskDelta,
      summary: resolved.divergence.summary,
    });
  }

  const authoritative = resolved.authoritative;
  const provenance: SizingProvenance = {
    authoritativeModel: resolved.authoritativeModel,
    shadowAvailable: brokerSpec !== null,
    // Authoritative provenance follows the authoritative model, including on
    // unavailable results — a shadow broker spec must never be reported here.
    specSource: resolved.authoritativeModel === 2 ? "broker" : "static_v1",
    specAsOf: resolved.authoritativeModel === 2 ? (brokerSpec?.asOf ?? null) : null,
    shadowSpecSource: brokerSpec ? "broker" : "static_v1",
    shadowSpecAsOf: brokerSpec?.asOf ?? null,
    specStale,
    quoteAsOf: conversion.quoteAsOf,
    quoteStale: conversion.stale,
    quoteMaxAgeMs: QUOTE_MAX_AGE_MS,
    conversionRoute: conversion.route,
    conversionRequests: conversion.requests,
    marginBasis: "notional_over_leverage",
    marginNote:
      "Estimate only: notional ÷ leverage. Real MT5 margin depends on the symbol calc mode and broker margin rates.",
    equityBasis: override ? "broker_reported" : "user_entered",
    equityAsOf,
    accountId: override?.accountId ?? null,
  };

  if (!authoritative.ok) {
    return {
      available: false,
      reason: authoritative.reason,
      explanation: RISK_UNAVAILABLE_COPY[authoritative.reason],
      provenance,
      profile,
      advisory,
    };
  }

  return {
    available: true,
    instrument: request.instrument,
    entryPrice: request.entryPrice,
    stopLoss: request.stopLoss,
    currency: authoritative.currency,
    quoteCurrency: authoritative.quoteCurrency,
    conversionRate: authoritative.conversionRate,
    lots: authoritative.lots,
    rawLots: authoritative.rawLots,
    riskAmount: authoritative.riskAmount,
    riskBudget: authoritative.riskBudget,
    riskPercentOfEquity: authoritative.riskPercentOfEquity,
    riskPerLot: authoritative.riskPerLot,
    stopDistance: authoritative.stopDistance,
    stopPercent: authoritative.stopPercent,
    notional: authoritative.notional,
    marginEstimate: authoritative.marginEstimate,
    marginPercentOfEquity: authoritative.marginPercentOfEquity,
    rewardAtFinalTarget: authoritative.rewardAtFinalTarget,
    finalTargetR: authoritative.finalTargetR,
    minStopDistance: authoritative.minStopDistance,
    brokerVolumeCap: authoritative.brokerVolumeCap,
    cappedByBrokerVolume: authoritative.cappedByBrokerVolume,
    cappedByPositionSize: authoritative.cappedByPositionSize,
    belowMinimumLot: authoritative.belowMinimumLot,
    exceedsMargin: authoritative.exceedsMargin,
    exceedsStopCeiling: authoritative.exceedsStopCeiling,
    guardrails: guardrailsFor(authoritative, profile),
    provenance,
    profile,
    advisory,
  };
}

/**
 * Prompt 14 Stage 3 closure (B/C) — AUTHORITATIVE sizing for a direct broker
 * destination.
 *
 * The order that reaches a broker must be sized from that broker's own numbers:
 * equity it reports and the contract specification it published for the symbol.
 * When either is missing we refuse (`no_equity` / `no_spec`) rather than sizing
 * from the trader's typed-in equity or from the benchmark broker's contract
 * table.
 */
export async function resolveSizingForAccount(
  db: Db,
  userId: string,
  account: { id: string; equity: number | null; currency: string | null; equityAsOf: string | null },
  request: SizingRequest,
  now = Date.now(),
): Promise<SizingResponse> {
  const { loadAccountSizingSpec, accountSpecStale } = await import("@/lib/accounts/specs.server");
  const spec = await loadAccountSizingSpec(db, account.id, request.instrument);
  const usableSpec = spec && !accountSpecStale(spec, now) ? spec : null;

  const equity =
    account.equity !== null && Number.isFinite(account.equity) && account.equity > 0
      ? account.equity
      : null;

  return await resolveSizingForUser(db, userId, request, now, {
    accountId: account.id,
    equity: equity ?? 0,
    currency: account.currency || "USD",
    equityAsOf: account.equityAsOf,
    spec: usableSpec,
  });
}
