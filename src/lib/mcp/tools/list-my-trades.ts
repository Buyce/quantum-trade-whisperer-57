import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_my_trades",
  title: "List my trades",
  description:
    "List the signed-in user's logged trade decisions and their outcomes, including the reported fill prices and who entered them (price_source: 'human' for the web terminal, 'agent' for an AI assistant, null when unverified).",
  inputSchema: {
    limit: z.number().int().optional().describe("Maximum rows to return (1-100, default 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const cap = Math.min(Math.max(limit ?? 20, 1), 100);
    const { data, error } = await supabase
      .from("executed_trades")
      .select("id, signal_id, user_decision, outcome, realized_r_multiple, derived_r, actual_entry_price, actual_exit_price, price_source, price_source_client, price_recorded_at, notes, created_at")
      .order("created_at", { ascending: false })
      .limit(cap);

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const rows = data ?? [];
    return {
      content: [
        { type: "text", text: rows.length === 0 ? "No logged trades yet." : JSON.stringify(rows) },
      ],
      structuredContent: { count: rows.length, trades: rows },
    };
  },
});
