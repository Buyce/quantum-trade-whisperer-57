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

  const state = args.state && args.state !== "all" ? args.state : undefined;
  // Demo and live are BOTH included by default; the filters only narrow.
  const accountType =
    args.account_type && args.account_type !== "all" ? args.account_type : undefined;

  /** Same filters for the page and for the total, so a count can never drift. */
  const applyFilters = <Q extends Record<string, (...a: never[]) => unknown>>(q: Q): Q => {
    let out = q as unknown as {
      eq: (c: string, v: unknown) => typeof out;
      or: (e: string) => typeof out;
      gte: (c: string, v: string) => typeof out;
      lte: (c: string, v: string) => typeof out;
    };
    if (state) out = out.eq("state", state);
    if (accountType) out = out.eq("broker_account_type", accountType);
    if (args.account_id) out = out.eq("account_id", args.account_id);
    if (args.instrument) {
      const symbol = args.instrument.toUpperCase();
      out = out.or(`broker_symbol.eq.${symbol},signal_instrument.eq.${symbol}`);
    }
    // The window is applied to the broker's own exit time — never a record time.
    if (window.fromMs !== null) out = out.gte("exit_at", new Date(window.fromMs).toISOString());
    if (window.toMs !== null) out = out.lte("exit_at", new Date(window.toMs).toISOString());
    return out as unknown as Q;
  };

  const query = applyFilters(db.from("broker_trade_evidence").select(COLUMNS) as never);
  const { data, error } = await (
    query as unknown as {
      order: (c: string, o: { ascending: boolean; nullsFirst: boolean }) => {
        limit: (n: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
      };
    }
  )
    .order(orderBy, { ascending: false, nullsFirst: false })
    .limit(cap);

  if (error) return { content: [{ type: "text" as const, text: error.message }], isError: true };
  const rows = (data ?? []) as Record<string, unknown>[];

  // [INVARIANT] `count` is the page size and must never be read as "how many
  // trades I have". `total_matching` is the real total for this exact query, so
  // a capped page can never be reported as the whole record.
  let totalMatching: number | null = null;
  const countRead = (await applyFilters(
    db.from("broker_trade_evidence").select("id", { count: "exact", head: true }) as never,
  )) as unknown as { count: number | null; error: { message: string } | null };
  if (!countRead?.error) totalMatching = countRead?.count ?? null;

  const payload = {
    count: rows.length,
    total_matching: totalMatching,
    page_truncated: totalMatching !== null && totalMatching > rows.length,
    window: window.label,
    state_filter: state ?? "any",
    account_type_filter: accountType ?? "all (demo and live)",
    account_id_filter: args.account_id ?? null,
    accounts_in_result: Array.from(
      new Set(
        (rows as Record<string, unknown>[]).map((row) =>
          String(row["broker_account_type"] ?? "unknown"),
        ),
      ),
    ),
    ordered_by: orderBy,
    provenance: "broker-derived: prices, volumes, costs and times as reported by the broker.",
    note:
      rows.length === 0
        ? `No broker-confirmed trades matched this query (${window.label}${state ? `, state=${state}` : ""}${accountType ? `, account_type=${accountType}` : ""}${args.instrument ? `, instrument=${args.instrument}` : ""}). That is a statement about THIS query only — widen the window or drop the filters before concluding anything.`
        : `Returned ${rows.length} of ${totalMatching ?? "an unknown number of"} matching trades — for "how many" use total_matching, never the page size. Demo and live trades are both returned unless account_type narrows them: say which mode each figure came from, and never present demo results as a live track record. R multiples are broker-derived where r_availability says so; money amounts are the user's own account and must never be compared against another account's money.`,
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
    "The signed-in user's BROKER-CONFIRMED trades (from broker evidence, not the self-reported journal), across ALL of their accounts — demo and live: instrument, direction, volume, entry and exit price and time, commission, swap, gross profit, R against plan and against actual risk, stop provenance, slippage, account id, account type and the setup grade the trade came from. This is the authority on what actually happened; the journal can be empty even when the user traded. Filterable by state, instrument, account type (demo/live) or a single account, windowed on the broker exit time, and sortable by exit time or by R so 'my best trade' is answered directly. Always say which mode a figure came from; a demo result is not a live track record.",
  inputSchema: {
    state: z
      .enum(["closed", "open", "all"])
      .optional()
      .describe("Trade state at the broker. Default: any state."),
    instrument: z.string().optional().describe("Instrument filter, e.g. XAUUSD."),
    account_type: z
      .enum(["demo", "live", "all"])
      .optional()
      .describe("Account mode filter. Default: all — demo and live together."),
    account_id: z
      .string()
      .optional()
      .describe("Restrict to one connected account id from list_my_accounts."),
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
