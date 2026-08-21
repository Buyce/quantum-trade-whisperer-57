import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "log_trade_decision",
  title: "Log trade decision",
  description:
    "Record the signed-in user's decision on a scanned signal: taken or skipped. Creates or updates that user's trade journal entry for the signal.",
  inputSchema: {
    signal_id: z.string().describe("The id of a signal returned by list_signals."),
    decision: z.enum(["taken", "skipped"]).describe("Whether the user took or skipped the setup."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ signal_id, decision }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("executed_trades")
      .upsert(
        {
          user_id: ctx.getUserId(),
          signal_id,
          user_decision: decision,
          outcome: "open",
          // Provenance: logged by an AI assistant over MCP, with the client id
          // so two assistants on one account stay distinguishable.
          decision_source: "agent",
          decision_source_client: ctx.getClientId() ?? "unknown",
        },
        { onConflict: "user_id,signal_id" },
      )
      .select("id, signal_id, user_decision, outcome, decision_source, created_at");

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Logged ${decision} for signal ${signal_id}.` }],
      structuredContent: { trade: data?.[0] ?? null },
    };
  },
});
