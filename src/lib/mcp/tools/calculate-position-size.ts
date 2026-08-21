import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { RISK_UNAVAILABLE_COPY, calculateRisk, riskProfileFromSettings } from "@/lib/risk";

/**
 * FX rates needed to convert quote-currency risk into the account currency.
 * Best-effort: a missing rate produces an explicit "unavailable" reason rather
 * than an assumed parity number.
 */
async function conversionRates(): Promise<Record<string, number>> {
  const rates: Record<string, number> = {};
  try {
    const { fetchQuote } = await import("@/lib/scanner/metaapi.server");
    for (const symbol of ["AUDUSD", "GBPUSD"]) {
      const q = await fetchQuote(symbol);
      if (q) rates[symbol] = (q.bid + q.ask) / 2;
    }
  } catch {
    // Leave rates empty; calculateRisk reports no_conversion_rate.
  }
  return rates;
}

export default defineTool({
  name: "calculate_position_size",
  title: "Calculate position size",
  description:
    "Size a setup using the signed-in user's saved risk profile. Pass a signal_id from list_signals, or an explicit instrument plus entry_price and stop_loss. Returns lot size, cash at risk, margin required and any guardrail warnings. Returns an explicit unavailable reason instead of a guess when equity or an FX rate is missing.",
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

    const result = calculateRisk(
      { instrument: symbol, entryPrice: entry, stopLoss: stop, finalTargetR },
      profile,
      await conversionRates(),
    );

    if (!result.ok) {
      const payload = {
        available: false,
        reason: result.reason,
        explanation: RISK_UNAVAILABLE_COPY[result.reason],
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
      warnings.push("Margin required exceeds account equity at this leverage.");
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
      margin_required: Number(result.marginRequired.toFixed(2)),
      margin_percent_of_equity: Number(result.marginPercentOfEquity.toFixed(2)),
      reward_at_final_target:
        result.rewardAtFinalTarget === null ? null : Number(result.rewardAtFinalTarget.toFixed(2)),
      final_target_r: result.finalTargetR,
      conversion_rate: result.conversionRate,
      warnings,
      risk_profile: profile,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
