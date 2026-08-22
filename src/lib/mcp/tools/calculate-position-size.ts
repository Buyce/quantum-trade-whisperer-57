import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { resolveSizingForUser } from "@/lib/sizing/service.server";

export default defineTool({
  name: "calculate_position_size",
  title: "Calculate position size",
  description:
    "Size a setup using the signed-in user's saved risk profile, through the SAME server sizing service the P-Trades terminal uses. Pass a signal_id from list_signals, or an explicit instrument plus entry_price and stop_loss. Returns lot size, cash at risk, an ESTIMATED margin (notional / leverage — not the broker's margin requirement), contract-specification and quote provenance, and any guardrail warnings. Account equity is user-entered, never broker-confirmed. Returns an explicit unavailable reason instead of a guess when equity, a broker specification or a fresh FX rate is missing.",
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
    const userId = ctx.getUserId() as string;

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

    const sizing = await resolveSizingForUser(supabase, userId, {
      instrument: symbol,
      entryPrice: entry,
      stopLoss: stop,
      finalTargetR,
      signalId: signal_id ?? null,
    });

    if (!sizing.available) {
      const payload = {
        available: false,
        reason: sizing.reason,
        explanation: sizing.explanation,
        provenance: sizing.provenance,
        risk_profile: sizing.profile,
        logged_exposure_advisory: sizing.advisory,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    }

    const payload = {
      available: true,
      instrument: sizing.instrument,
      entry_price: sizing.entryPrice,
      stop_loss: sizing.stopLoss,
      currency: sizing.currency,
      lots: Number(sizing.lots.toFixed(2)),
      cash_at_risk: Number(sizing.riskAmount.toFixed(2)),
      risk_budget: Number(sizing.riskBudget.toFixed(2)),
      risk_percent_of_equity: Number(sizing.riskPercentOfEquity.toFixed(3)),
      stop_distance: sizing.stopDistance,
      stop_percent: Number(sizing.stopPercent.toFixed(3)),
      broker_min_stop_distance: sizing.minStopDistance,
      notional: Number(sizing.notional.toFixed(2)),
      margin_estimate: Number(sizing.marginEstimate.toFixed(2)),
      margin_estimate_basis: sizing.provenance.marginBasis,
      margin_estimate_note: sizing.provenance.marginNote,
      margin_percent_of_equity: Number(sizing.marginPercentOfEquity.toFixed(2)),
      reward_at_final_target:
        sizing.rewardAtFinalTarget === null ? null : Number(sizing.rewardAtFinalTarget.toFixed(2)),
      final_target_r: sizing.finalTargetR,
      conversion_rate: sizing.conversionRate,
      warnings: sizing.guardrails,
      provenance: sizing.provenance,
      risk_profile: sizing.profile,
      logged_exposure_advisory: sizing.advisory,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
