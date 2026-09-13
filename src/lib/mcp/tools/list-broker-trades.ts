import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { resolveWindow } from "./get-performance-summary";

/**
 * Broker-confirmed trades for the signed-in user, read from
 * `broker_trade_evidence`.
 *
 * [INVARIANT] This is the AUTHORITY on what actually happened at the broker.
 * The self-reported journal (`executed_trades`) is the user's own notes and can
 * be empty even when they traded, so an empty journal must never be reported as
 * "no trades" — this tool exists so that answer is impossible.
 *
 * [INVARIANT] Scoped by the table's own `user_id = auth.uid()` SELECT policy;
 * `user_id` is never projected, and no other account's rows are reachable.
 */
export type BrokerTradesArgs = {
  state?: string | undefined;
  instrument?: string | undefined;
  account_type?: string | undefined;
  account_id?: string | undefined;
  days?: number | undefined;
  from?: string | undefined;
  to?: string | undefined;
  order_by?: string | undefined;
  limit?: number | undefined;
};

const COLUMNS =
  "id, state, account_id, broker_symbol, signal_instrument, signal_grade, direction, volume, entry_price, exit_price, entry_at, exit_at, planned_entry, planned_stop, planned_target, actual_initial_stop, commission, swap, gross_profit, profit_currency, r_vs_plan, r_vs_actual_risk, r_availability, stop_provenance, stop_source, slippage_price, slippage_availability, execution_policy, managed_exit, broker_account_type, signal_trading_session, signal_detected_at, resolved_at";

/** Shared body — the MCP handler and the in-app assistant call this same code. */
export async function runListBrokerTrades(supabase: unknown, args: BrokerTradesArgs) {
  const db = supabase as ReturnType<typeof supabaseForUser>;
  const cap = Math.min(Math.max(args.limit ?? 20, 1), 100);
  const window = resolveWindow({ days: args.days, from: args.from, to: args.to });
  if (window.invalid) {
    return { content: [{ type: "text" as const, text: window.invalid }], isError: true };
  }
  const orderBy = args.order_by === "r_vs_actual_risk" ? "r_vs_actual_risk" : "exit_at";

  let query = db.from("broker_trade_evidence").select(COLUMNS);
  const state = args.state && args.state !== "all" ? args.state : undefined;
  if (state) query = query.eq("state", state);
  if (args.instrument) {
    const symbol = args.instrument.toUpperCase();
    query = query.or(`broker_symbol.eq.${symbol},signal_instrument.eq.${symbol}`);
  }
  // The window is applied to the broker's own exit time — never to a record time.
  if (window.fromMs !== null) query = query.gte("exit_at", new Date(window.fromMs).toISOString());
  if (window.toMs !== null) query = query.lte("exit_at", new Date(window.toMs).toISOString());

  const { data, error } = await query
    .order(orderBy, { ascending: false, nullsFirst: false })
    .limit(cap);

  if (error) return { content: [{ type: "text" as const, text: error.message }], isError: true };
  const rows = data ?? [];
  const payload = {
    count: rows.length,
    window: window.label,
    state_filter: state ?? "any",
    ordered_by: orderBy,
    provenance: "broker-derived: prices, volumes, costs and times as reported by the broker.",
    note:
      rows.length === 0
        ? `No broker-confirmed trades matched this query (${window.label}${state ? `, state=${state}` : ""}${args.instrument ? `, instrument=${args.instrument}` : ""}). That is a statement about THIS query only — widen the window or drop the filters before concluding anything.`
        : "R multiples are broker-derived where r_availability says so; money amounts are the user's own account and must never be compared against another account's money.",
    trades: rows,
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

export default defineTool({
  name: "list_broker_trades",
  title: "List my broker-confirmed trades",
  description:
    "The signed-in user's BROKER-CONFIRMED trades (from broker evidence, not the self-reported journal): instrument, direction, volume, entry and exit price and time, commission, swap, gross profit, R against plan and against actual risk, stop provenance, slippage and the setup grade the trade came from. This is the authority on what actually happened; the journal can be empty even when the user traded. Filterable by state and instrument, windowed on the broker exit time, and sortable by exit time or by R so 'my best trade' is answered directly.",
  inputSchema: {
    state: z
      .enum(["closed", "open", "all"])
      .optional()
      .describe("Trade state at the broker. Default: any state."),
    instrument: z.string().optional().describe("Instrument filter, e.g. XAUUSD."),
    days: z.number().int().positive().optional().describe("Look-back in days on the exit time."),
    from: z.string().optional().describe("ISO UTC start of the window. Overrides days."),
    to: z.string().optional().describe("ISO UTC end of the window. Defaults to now."),
    order_by: z
      .enum(["exit_at", "r_vs_actual_risk"])
      .optional()
      .describe("Sort key, descending. Use r_vs_actual_risk for best/worst trades."),
    limit: z.number().int().optional().describe("Max rows (1-100, default 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    return runListBrokerTrades(supabaseForUser(ctx), input);
  },
});
