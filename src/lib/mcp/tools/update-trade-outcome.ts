import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { computeR, computeNetR, R_MATH_VERSION, RMathInputError } from "../../journal/r-math";

/**
 * R is NEVER accepted from the caller. When the agent supplies the real fill and
 * exit prices, both canonical R values are recomputed here through the SAME
 * shared module the web journal uses (`src/lib/journal/r-math.ts`), from the
 * trade's own immutable plan snapshot:
 *
 *   r_vs_plan        = gross move / |planned_entry - planned_stop|
 *   r_vs_actual_risk = gross move / |actual_entry - actual_or_planned_stop|
 *
 * Frozen legacy columns are never written. A resolved trade is never silently
 * rewritten: the tool reports it as already resolved instead.
 */
export default defineTool({
  name: "update_trade_outcome",
  title: "Update trade outcome",
  description:
    "Set the outcome (win, loss, breakeven or open) on one of the signed-in user's logged trades. Supply actual_entry_price and actual_exit_price to have both canonical R multiples recomputed server-side (R vs plan and R vs actual risk) — that records the trade as self_reported (the user's or your own reported prices, NOT broker verified). Optionally supply actual_initial_stop for a true actual-risk denominator, and commission/swap as money. Without prices, R stays unknown; the R multiple can never be supplied directly. An already-resolved trade is not modified.",
  inputSchema: {
    trade_id: z.string().describe("The id of a trade returned by list_my_trades."),
    outcome: z
      .enum(["win", "loss", "breakeven", "open"])
      .describe("Resolved outcome of the trade."),
    actual_entry_price: z.number().optional().describe("The real fill price the user got."),
    actual_exit_price: z.number().optional().describe("The real exit price the user got."),
    actual_initial_stop: z
      .number()
      .optional()
      .describe("The stop the user actually placed at the broker, if they reported it."),
    commission: z.number().optional().describe("Commission in money, not price distance."),
    swap: z.number().optional().describe("Swap/financing in money, not price distance."),
    cost_currency: z.string().max(16).optional().describe("Currency of commission/swap."),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async (input, ctx) => {
    const {
      trade_id,
      outcome,
      actual_entry_price,
      actual_exit_price,
      actual_initial_stop,
      commission,
      swap,
      cost_currency,
    } = input;
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);

    const { data: trade, error: readError } = await supabase
      .from("executed_trades")
      .select(
        "id, signal_id, outcome, planned_entry, planned_stop, planned_direction, r_vs_plan, r_vs_actual_risk, r_availability, stop_provenance",
      )
      .eq("id", trade_id)
      .maybeSingle();
    if (readError) return { content: [{ type: "text", text: readError.message }], isError: true };
    if (!trade) {
      return {
        content: [{ type: "text", text: `No trade ${trade_id} found for this user.` }],
        isError: true,
      };
    }

    if (trade.outcome !== "open") {
      const payload = {
        trade,
        already_resolved: true,
        note: `This trade is already resolved as ${trade.outcome}. Nothing was changed. A resolved trade can only be altered through an explicit correction workflow.`,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    }

    // One-sided prices are a data-entry error, never a NULL R. Rejected BEFORE
    // any database mutation, and never collapsed to null/null.
    const entrySupplied = actual_entry_price != null;
    const exitSupplied = actual_exit_price != null;
    if (entrySupplied !== exitSupplied) {
      const missing = entrySupplied ? "actual_exit_price" : "actual_entry_price";
      return {
        content: [
          {
            type: "text",
            text: `Rejected: ${missing} is missing. Supply actual_entry_price and actual_exit_price together or omit both. Nothing was changed.`,
          },
        ],
        isError: true,
      };
    }

    const priceValid = (v: number | undefined) => v != null && Number.isFinite(v) && v > 0;
    const closed = outcome !== "open";
    const hasPrices = closed && priceValid(actual_entry_price) && priceValid(actual_exit_price);

    // Direction fails closed: snapshot first, then the exact direction from the
    // referenced signal for pre-snapshot legacy rows. Never assumed to be long.
    let direction = (trade.planned_direction as "long" | "short" | null) ?? null;
    if (direction == null && trade.signal_id) {
      const { data: signal } = await supabase
        .from("scanned_signals")
        .select("direction")
        .eq("id", trade.signal_id)
        .maybeSingle();
      const raw = signal?.direction == null ? null : String(signal.direction);
      direction = raw === "long" || raw === "short" ? raw : null;
    }

    let result;
    try {
      result = computeR({
        outcome,
        direction,
        plannedEntry: trade.planned_entry == null ? null : Number(trade.planned_entry),
        plannedStop: trade.planned_stop == null ? null : Number(trade.planned_stop),
        actualEntryPrice: hasPrices ? (actual_entry_price as number) : null,
        actualExitPrice: hasPrices ? (actual_exit_price as number) : null,
        actualInitialStop: hasPrices && priceValid(actual_initial_stop)
          ? (actual_initial_stop as number)
          : null,
      });
    } catch (err) {
      const message =
        err instanceof RMathInputError ? `Invalid execution prices: ${err.message}` : String(err);
      return { content: [{ type: "text", text: message }], isError: true };
    }

    // Costs are money. Without documented conversion provenance, net R stays
    // explicitly unavailable — never quietly equal to gross R.
    const net = computeNetR(result.rVsActualRisk ?? result.rVsPlan, {
      commission: commission ?? null,
      swap: swap ?? null,
      costCurrency: cost_currency ?? null,
      costUnit: commission != null || swap != null ? "account_currency" : null,
      documentedRValueInCostCurrency: null,
    });

    const { data, error } = await supabase
      .from("executed_trades")
      .update({
        outcome,
        trade_state: closed ? "resolved" : "open",
        actual_entry_price: hasPrices ? (actual_entry_price as number) : null,
        actual_exit_price: hasPrices ? (actual_exit_price as number) : null,
        actual_initial_stop:
          hasPrices && priceValid(actual_initial_stop) ? (actual_initial_stop as number) : null,
        r_vs_plan: result.rVsPlan,
        r_vs_actual_risk: result.rVsActualRisk,
        r_availability: result.availability,
        stop_provenance: result.stopProvenance,
        r_math_version: R_MATH_VERSION,
        net_r: net.netR,
        commission: commission ?? null,
        swap: swap ?? null,
        cost_currency: cost_currency ?? null,
        cost_unit: commission != null || swap != null ? "account_currency" : null,
        verification_level: hasPrices ? "self_reported" : "unverified",
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
        "id, signal_id, user_decision, outcome, actual_entry_price, actual_exit_price, actual_initial_stop, r_vs_plan, r_vs_actual_risk, r_availability, stop_provenance, r_math_version, net_r, verification_level, price_source, price_source_client, price_recorded_at",
      );

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data || data.length === 0) {
      return {
        content: [{ type: "text", text: `No trade ${trade_id} found for this user.` }],
        isError: true,
      };
    }

    const payload = {
      trade: data[0],
      already_resolved: false,
      /**
       * LEGACY COMPATIBILITY BOOLEAN ONLY. It means "execution prices are
       * present", never "broker verified". Read `verification_level`.
       */
      verified: hasPrices,
      verified_meaning:
        "legacy compatibility flag: prices present. Not a broker verification. Use verification_level.",
      verification_level: hasPrices ? "self_reported" : "unverified",
      r_vs_plan: result.rVsPlan,
      r_vs_actual_risk: result.rVsActualRisk,
      r_availability: result.availability,
      stop_provenance: result.stopProvenance,
      net_r: net.netR,
      net_r_note: net.note,
      price_source: hasPrices ? "agent" : null,
      note: result.availability === "unavailable_no_direction"
        ? "This trade's direction could not be established (no plan snapshot and no surviving signal), so no canonical R was computed. Direction is never assumed — do not report an R for this trade."
        : !hasPrices
        ? "verification_level = unverified: supply actual_entry_price and actual_exit_price on a closed trade to compute auditable R values."
        : "verification_level = self_reported — these prices came from the user or from you and are NOT broker verified. Only replay/market-path consistency could ever raise this to plan_verified, which still never means broker execution verified. Both canonical R values were recomputed from the supplied prices and the trade's own plan snapshot. Never average the two bases together. These prices are permanently recorded as agent-entered, attributed to this assistant's client id — only report prices the user actually gave you.",
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
