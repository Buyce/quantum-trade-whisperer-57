import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

/**
 * R is NEVER accepted from the caller. When the agent supplies the real fill and
 * exit prices, R is recomputed here from the originating signal's own risk
 * distance (|entry - stop|), exactly as the web journal does, so the number is
 * reproducible and the trade counts as VERIFIED. Without prices, R stays null —
 * an honest unknown rather than a preset guess.
 */
export default defineTool({
  name: "update_trade_outcome",
  title: "Update trade outcome",
  description:
    "Set the outcome (win, loss, breakeven or open) on one of the signed-in user's logged trades. Supply actual_entry_price and actual_exit_price to have the R multiple recomputed server-side from the signal's own risk distance — that marks the trade VERIFIED. Without prices the trade stays unverified and R is left unknown; the R multiple can never be supplied directly.",
  inputSchema: {
    trade_id: z.string().describe("The id of a trade returned by list_my_trades."),
    outcome: z.enum(["win", "loss", "breakeven", "open"]).describe("Resolved outcome of the trade."),
    actual_entry_price: z.number().optional().describe("The real fill price the user got."),
    actual_exit_price: z.number().optional().describe("The real exit price the user got."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ trade_id, outcome, actual_entry_price, actual_exit_price }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);

    const { data: trade, error: readError } = await supabase
      .from("executed_trades")
      .select("id, signal_id, scanned_signals(entry_price, stop_loss, direction)")
      .eq("id", trade_id)
      .maybeSingle();
    if (readError) return { content: [{ type: "text", text: readError.message }], isError: true };
    if (!trade) {
      return { content: [{ type: "text", text: `No trade ${trade_id} found for this user.` }], isError: true };
    }

    const rawSignal = (trade as { scanned_signals: unknown }).scanned_signals;
    const signal = (Array.isArray(rawSignal) ? rawSignal[0] : rawSignal) as
      | { entry_price: number; stop_loss: number; direction: "long" | "short" }
      | null
      | undefined;

    const priceValid = (v: number | undefined) => v != null && Number.isFinite(v) && v > 0;
    const closed = outcome !== "open";
    const hasPrices = closed && priceValid(actual_entry_price) && priceValid(actual_exit_price);

    let derivedR: number | null = null;
    if (hasPrices && signal) {
      const risk = Math.abs(Number(signal.entry_price) - Number(signal.stop_loss));
      if (risk > 0) {
        const move =
          signal.direction === "long"
            ? (actual_exit_price as number) - (actual_entry_price as number)
            : (actual_entry_price as number) - (actual_exit_price as number);
        derivedR = Math.round((move / risk) * 10000) / 10000;
      }
    }

    const { data, error } = await supabase
      .from("executed_trades")
      .update({
        outcome,
        actual_entry_price: hasPrices ? (actual_entry_price as number) : null,
        actual_exit_price: hasPrices ? (actual_exit_price as number) : null,
        derived_r: derivedR,
        realized_r_multiple: derivedR,
        // Provenance is stamped from the request path, not from tool input: this
        // handler is only reachable over MCP, so the author is an agent. The
        // OAuth client id names WHICH assistant, so a hallucinating client is
        // traceable. Cleared with the prices it describes.
        price_source: hasPrices ? "agent" : null,
        price_source_client: hasPrices ? (ctx.getClientId() ?? "unknown") : null,
        price_recorded_at: hasPrices ? new Date().toISOString() : null,
      })
      .eq("id", trade_id)
      .select(
        "id, signal_id, user_decision, outcome, actual_entry_price, actual_exit_price, derived_r, realized_r_multiple, price_source, price_source_client, price_recorded_at",
      );

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data || data.length === 0) {
      return { content: [{ type: "text", text: `No trade ${trade_id} found for this user.` }], isError: true };
    }

    const payload = {
      trade: data[0],
      verified: derivedR !== null,
      derived_r: derivedR,
      price_source: hasPrices ? "agent" : null,
      note:
        derivedR === null
          ? "Unverified: supply actual_entry_price and actual_exit_price on a closed trade to compute an auditable R."
          : "Verified: R was recomputed from the supplied prices and the signal's risk distance. These prices are permanently recorded as agent-entered, attributed to this assistant's client id — only report prices the user actually gave you.",
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
