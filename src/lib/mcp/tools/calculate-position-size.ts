import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import {
  CONTRACT_SPECS,
  RISK_UNAVAILABLE_COPY,
  calculateRisk,
  riskProfileFromSettings,
} from "@/lib/risk";
import { planConversion, resolveConversionRates } from "../fx";

/**
 * FX rates needed to convert quote-currency risk into the account currency.
 * Demand-driven: zero requests when the currencies already match, and only the
 * legs the route actually needs otherwise. A missing rate produces an explicit
 * "unavailable" reason rather than an assumed parity number.
 */
async function conversionRates(
  instrument: string,
  accountCurrency: string,
): Promise<{ rates: Record<string, number>; route: string; requests: number }> {
  const quote = CONTRACT_SPECS[instrument]?.quote;
  if (!quote) return { rates: {}, route: "unknown_instrument", requests: 0 };
  const plan = planConversion(quote, accountCurrency);
  if (plan.symbols.length === 0) {
    return { rates: {}, route: plan.kind, requests: 0 };
  }
  try {
    const { fetchQuote } = await import("@/lib/scanner/metaapi.server");
    const resolved = await resolveConversionRates(quote, accountCurrency, fetchQuote);
    return { rates: resolved.rates, route: resolved.plan.kind, requests: resolved.requests };
  } catch {
    // Leave rates empty; calculateRisk reports no_conversion_rate.
    return { rates: {}, route: plan.kind, requests: 0 };
  }
}

export default defineTool({
  name: "calculate_position_size",
  title: "Calculate position size",
  description:
    "Size a setup using the signed-in user's saved risk profile. Pass a signal_id from list_signals, or an explicit instrument plus entry_price and stop_loss. Returns lot size, cash at risk, an ESTIMATED margin (notional / leverage — not the broker's margin requirement) and any guardrail warnings. Returns an explicit unavailable reason instead of a guess when equity or an FX rate is missing.",
  inputSchema: {
    signal_id: z.string().optional().describe("Signal id from list_signals."),
    instrument: z
      .string()
      .optional()
      .describe("XAUUSD, GBPAUD or EURUSD (with entry_price and stop_loss)."),
    entry_price: z.number().optional(),
    stop_loss: z.number().optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
  handler: async ({ signal_id, instrument, entry_price, stop_loss }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);

    const { data: settings, error: settingsError } = await supabase
      .from("scanner_settings")
      .select(
        "account_equity, account_currency, risk_per_trade_percent, max_position_size, leverage, max_stop_loss_percent",
      )
      .maybeSingle();
    if (settingsError) {
      return { content: [{ type: "text", text: settingsError.message }], isError: true };
    }
    const profile = riskProfileFromSettings(settings);

    let symbol = instrument;
    let entry = entry_price;
    let stop = stop_loss;
    let finalTargetR: number | null = null;

    if (signal_id) {
      const { data: signal, error } = await supabase
        .from("scanned_signals")
        .select("instrument, entry_price, stop_loss, max_r, tp3_r, tp2_r, tp1_r")
        .eq("id", signal_id)
        .maybeSingle();
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      if (!signal) {
        return {
          content: [{ type: "text", text: `No signal ${signal_id} found.` }],
          isError: true,
        };
      }
      symbol = signal.instrument;
      entry = Number(signal.entry_price);
      stop = Number(signal.stop_loss);
      const r = signal.max_r ?? signal.tp3_r ?? signal.tp2_r ?? signal.tp1_r;
      finalTargetR = r == null ? null : Number(r);
    }

    if (!symbol || entry == null || stop == null) {
      return {
        content: [
          {
            type: "text",
            text: "Provide either signal_id, or instrument plus entry_price and stop_loss.",
          },
        ],
        isError: true,
      };
    }

    const conversion = await conversionRates(symbol, profile.accountCurrency);
    const result = calculateRisk(
      { instrument: symbol, entryPrice: entry, stopLoss: stop, finalTargetR },
      profile,
      conversion.rates,
    );

    if (!result.ok) {
      const payload = {
        available: false,
        reason: result.reason,
        explanation: RISK_UNAVAILABLE_COPY[result.reason],
        conversion_route: conversion.route,
        risk_profile: profile,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    }

    const warnings: string[] = [];
    if (result.belowMinimumLot) warnings.push("Risk budget is too small to open the minimum lot.");
    if (result.cappedByPositionSize)
      warnings.push("Size limited by the user's max position size, not by risk.");
    if (result.exceedsMargin)
      warnings.push(
        "Estimated margin (notional / leverage) exceeds account equity at this leverage. This is an estimate, not the broker's margin requirement.",
      );
    if (result.exceedsStopCeiling)
      warnings.push("Stop distance is wider than the user's max stop-loss percent.");

    const payload = {
      available: true,
      instrument: symbol,
      entry_price: entry,
      stop_loss: stop,
      currency: result.currency,
      lots: Number(result.lots.toFixed(2)),
      cash_at_risk: Number(result.riskAmount.toFixed(2)),
      risk_budget: Number(result.riskBudget.toFixed(2)),
      risk_percent_of_equity: Number(result.riskPercentOfEquity.toFixed(3)),
      stop_distance: result.stopDistance,
      stop_percent: Number(result.stopPercent.toFixed(3)),
      notional: Number(result.notional.toFixed(2)),
      margin_estimate: Number(result.marginEstimate.toFixed(2)),
      margin_estimate_basis: result.marginBasis,
      margin_estimate_note:
        "Estimate only: notional / leverage. Real MT5 margin depends on the symbol calc mode and broker margin rates.",
      margin_percent_of_equity: Number(result.marginPercentOfEquity.toFixed(2)),
      spec_source: result.specSource,
      spec_as_of: result.specAsOf,
      sizing_model_version: result.sizingModelVersion,
      reward_at_final_target:
        result.rewardAtFinalTarget === null ? null : Number(result.rewardAtFinalTarget.toFixed(2)),
      final_target_r: result.finalTargetR,
      conversion_rate: result.conversionRate,
      conversion_route: conversion.route,
      warnings,
      risk_profile: profile,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
