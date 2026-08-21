import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { R_MATH_VERSION } from "../../journal/r-math";
import {
  buildJournalSnapshot,
  planDecisionWrite,
  type SignalSnapshotSource,
} from "../../journal/decision";

export default defineTool({
  name: "log_trade_decision",
  title: "Log trade decision",
  description:
    "Record the signed-in user's decision on a scanned signal: taken or skipped. Creates or updates that user's trade journal entry for the signal. A trade that is already resolved is never altered.",
  inputSchema: {
    signal_id: z.string().describe("The id of a signal returned by list_signals."),
    decision: z.enum(["taken", "skipped"]).describe("Whether the user took or skipped the setup."),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async ({ signal_id, decision }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const userId = ctx.getUserId();

    // Read-then-branch: identical semantics to the web terminal writer. An
    // update never carries `outcome`, so an agent retry cannot reopen a
    // resolved trade.
    const { data: existing, error: readError } = await supabase
      .from("executed_trades")
      .select("id, outcome, user_decision")
      .eq("user_id", userId!)
      .eq("signal_id", signal_id)
      .maybeSingle();
    if (readError) return { content: [{ type: "text", text: readError.message }], isError: true };

    const plan = planDecisionWrite(existing ?? null, decision);

    if (plan.action === "already_resolved") {
      return {
        content: [{ type: "text", text: plan.message }],
        structuredContent: { already_resolved: true, trade: existing },
      };
    }

    if (plan.action === "update") {
      const { data, error } = await supabase
        .from("executed_trades")
        .update({
          user_decision: decision,
          decision_source: "agent",
          decision_source_client: ctx.getClientId() ?? "unknown",
        })
        .eq("id", existing!.id)
        .select("id, signal_id, user_decision, outcome, decision_source, created_at");
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      return {
        content: [{ type: "text", text: plan.message }],
        structuredContent: { already_resolved: false, trade: data?.[0] ?? null },
      };
    }

    const { data: signalRow, error: signalError } = await supabase
      .from("scanned_signals")
      .select(
        "id, detected_at, instrument, grade, direction, entry_price, stop_loss, market_context(trading_session, time_of_day, day_of_week)",
      )
      .eq("id", signal_id)
      .maybeSingle();
    if (signalError)
      return { content: [{ type: "text", text: signalError.message }], isError: true };
    if (!signalRow)
      return { content: [{ type: "text", text: `Signal ${signal_id} not found.` }], isError: true };

    const snapshot = buildJournalSnapshot(signalRow as unknown as SignalSnapshotSource);

    const { data, error } = await supabase
      .from("executed_trades")
      .insert({
        user_id: userId!,
        signal_id,
        user_decision: decision,
        outcome: "open",
        trade_state: "logged",
        r_math_version: R_MATH_VERSION,
        // Provenance: logged by an AI assistant over MCP, with the client id
        // so two assistants on one account stay distinguishable.
        decision_source: "agent",
        decision_source_client: ctx.getClientId() ?? "unknown",
        ...snapshot,
      })
      .select("id, signal_id, user_decision, outcome, decision_source, created_at");

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Logged ${decision} for signal ${signal_id}.` }],
      structuredContent: { already_resolved: false, trade: data?.[0] ?? null },
    };
  },
});
