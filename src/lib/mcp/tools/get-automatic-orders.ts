import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { describeEnqueueDecision } from "@/lib/delivery/enqueue-log";

/**
 * The caller's own automatic-order decisions and deliveries.
 *
 * WHY IT EXISTS. Automatic ordering became the largest thing the terminal does,
 * and an assistant had no way to see any of it — so "did anything get ordered
 * today, and if not why" could only be answered from the screen.
 *
 * PROVENANCE. Decisions and refusal reasons are ENGINE-derived: they are the
 * rows the queue itself wrote, rendered with the same wording the app shows.
 * Delivery states are BROKER-derived once the order left P-Trades. Nothing here
 * is inferred, and an empty result only means no row matched this window — it is
 * never evidence about the scanner's cycle or about the market.
 */
export interface GetAutomaticOrdersArgs {
  hours?: number | undefined;
  limit?: number | undefined;
}

/** Shared body — the MCP handler and the in-app assistant call this same code. */
export async function runGetAutomaticOrders(supabase: unknown, args: GetAutomaticOrdersArgs) {
  const hours = Math.min(Math.max(Math.round(Number(args.hours ?? 24)) || 24, 1), 168);
  const limit = Math.min(Math.max(Math.round(Number(args.limit ?? 25)) || 25, 1), 100);
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();

  const db = supabase as ReturnType<typeof supabaseForUser>;
  const [decisionsRead, deliveriesRead] = await Promise.all([
    db
      .from("execution_enqueue_decisions")
      .select("created_at, instrument, grade, decision, detail, enqueued, filtered")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit),
    db
      .from("execution_deliveries")
      .select(
        "id, enqueued_at, state, reason, broker_symbol, dry_run, submitted_at, broker_order_id, broker_order_state, broker_retcode_string, entry_mode, execution_policy, account_mode, connected_account_id, destination_type",
      )
      .gte("enqueued_at", since)
      .order("enqueued_at", { ascending: false })
      .limit(limit),
  ]);

  if (decisionsRead.error) {
    return { content: [{ type: "text" as const, text: decisionsRead.error.message }], isError: true };
  }
  if (deliveriesRead.error) {
    return { content: [{ type: "text" as const, text: deliveriesRead.error.message }], isError: true };
  }

  const decisionRows = (decisionsRead.data ?? []) as Record<string, unknown>[];
  const deliveryRows = (deliveriesRead.data ?? []) as Record<string, unknown>[];

  const decisions = decisionRows.map((row) => ({
    at: String(row["created_at"]),
    instrument: (row["instrument"] as string | null) ?? null,
    grade: (row["grade"] as string | null) ?? null,
    decision: String(row["decision"]),
    // Same sentence the terminal shows, so an assistant cannot paraphrase a
    // refusal into a claim about the market.
    explanation: describeEnqueueDecision(String(row["decision"])),
    detail: (row["detail"] as string | null) ?? null,
    enqueued: Number(row["enqueued"] ?? 0),
    filtered: Number(row["filtered"] ?? 0),
    provenance: "engine-derived",
  }));

  const deliveries = deliveryRows.map((row) => ({
    id: row["id"] ?? null,
    at: String(row["enqueued_at"]),
    instrument: (row["broker_symbol"] as string | null) ?? null,
    state: (row["state"] as string | null) ?? null,
    reason: (row["reason"] as string | null) ?? null,
    dry_run: row["dry_run"] === true,
    submitted_at: (row["submitted_at"] as string | null) ?? null,
    broker_order_id: (row["broker_order_id"] as string | null) ?? null,
    broker_order_state: (row["broker_order_state"] as string | null) ?? null,
    broker_message: (row["broker_retcode_string"] as string | null) ?? null,
    entry_mode: (row["entry_mode"] as string | null) ?? null,
    exit_policy: (row["execution_policy"] as string | null) ?? null,
    provenance: row["submitted_at"] ? "broker-derived once submitted" : "engine-derived",
  }));

  const counts = decisions.reduce<Record<string, number>>((acc, row) => {
    acc[row.decision] = (acc[row.decision] ?? 0) + 1;
    return acc;
  }, {});

  const payload = {
    window: { since, hours },
    truncated: decisions.length >= limit || deliveries.length >= limit,
    decisions,
    deliveries,
    decision_counts: counts,
    notes: {
      empty_result:
        "No rows in this window means nothing matched this user's window — not that the scanner is idle and not that no valid setup existed. Use get_scanner_status for engine state.",
      refusals:
        "A refusal is a rule doing its job. It says nothing about whether the refused setup would have won or lost.",
      broker_states:
        "A pending or acknowledged order is resting at the broker and is NOT a fill. Only a broker-confirmed fill is a trade.",
      dry_run: "dry_run rows were never sent to a broker.",
    },
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

export default defineTool({
  name: "get_automatic_orders",
  title: "Get my automatic orders",
  description:
    "Read the signed-in user's own recent automatic-order activity: the decisions the queue recorded (queued, or refused with the exact reason — your ceilings, order window, instruments, sessions, intelligence gate, news rule, duplicate guard, same-bet limit or cool-off, or a risk brake) and the resulting broker deliveries with their last known state (pending, sent, acknowledged, filled, rejected, expired, cancelled). Decisions and refusal reasons are engine-derived; delivery and order states are broker-derived once the order was submitted. An empty result means nothing matched this window for this user — it is not evidence about the scanner's cycle, the market, or whether a valid setup existed. Never invent an order, a fill or a reason.",
  inputSchema: {
    hours: z
      .number()
      .optional()
      .describe("How far back to look, in hours (1-168). Defaults to 24."),
    limit: z.number().optional().describe("Maximum rows per section (1-100). Defaults to 25."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    return runGetAutomaticOrders(supabaseForUser(ctx), input);
  },
});
