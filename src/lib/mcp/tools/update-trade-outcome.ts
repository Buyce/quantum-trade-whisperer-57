import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "update_trade_outcome",
  title: "Update trade outcome",
  description:
    "Set the outcome (win, loss, breakeven or open) and realized R-multiple on one of the signed-in user's logged trades.",
  inputSchema: {
    trade_id: z.string().describe("The id of a trade returned by list_my_trades."),
    outcome: z.enum(["win", "loss", "breakeven", "open"]).describe("Resolved outcome of the trade."),
    realized_r_multiple: z
      .number()
      .optional()
      .describe("Realized result in R multiples, e.g. 2.5 for a 2.5R win or -1 for a full stop."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ trade_id, outcome, realized_r_multiple }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("executed_trades")
      .update({ outcome, realized_r_multiple: realized_r_multiple ?? null })
      .eq("id", trade_id)
      .select("id, signal_id, user_decision, outcome, realized_r_multiple");

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data || data.length === 0) {
      return { content: [{ type: "text", text: `No trade ${trade_id} found for this user.` }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data[0]) }],
      structuredContent: { trade: data[0] },
    };
  },
});
