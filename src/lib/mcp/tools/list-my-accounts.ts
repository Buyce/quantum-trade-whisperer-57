import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

/**
 * The signed-in user's own connected broker accounts — DEMO and LIVE alike.
 *
 * WHY IT EXISTS. Most P-Trades activity happens on demo accounts, and the
 * assistant had no way to see the account layer at all: which accounts exist,
 * which mode each is in, and which one a trade or delivery belongs to. Without
 * it, "how is my demo doing" could not be answered honestly.
 *
 * PROVENANCE. Every figure here is broker-derived, observed at
 * `broker_observed_at`, except the user's own label and intent. RLS scopes this
 * to the caller's own accounts; another user's accounts are unreachable and
 * their money must never be discussed.
 */
export type MyAccountsArgs = {
  mode?: string | undefined;
  include_disconnected?: boolean | undefined;
};

const COLUMNS =
  "id, label, mode, phase, intent, platform, region, broker_name, broker_server, broker_account_type, broker_login_masked, account_currency, broker_balance, broker_equity, broker_free_margin, broker_margin_level, leverage, margin_mode, trade_allowed, investor_mode, connection_status, credentials_configured, provisioning_state, is_benchmark, magic, max_account_open_positions, emergency_stop_at, emergency_stop_reason, stand_down_reason, intent_conflict, intent_conflict_reason, last_error, broker_observed_at, last_reconciled_at, reconciliation_last_success_at, reconciliation_last_error, reconciliation_last_error_at, disconnected_at, created_at";

/** Shared body — the MCP handler and the in-app assistant call this same code. */
export async function runListMyAccounts(supabase: unknown, args: MyAccountsArgs = {}) {
  const db = supabase as ReturnType<typeof supabaseForUser>;
  let query = db.from("connected_trading_accounts").select(COLUMNS);
  const mode = args.mode && args.mode !== "all" ? args.mode : undefined;
  if (mode) query = query.eq("mode", mode);
  if (args.include_disconnected !== true) query = query.is("disconnected_at", null);

  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) return { content: [{ type: "text" as const, text: error.message }], isError: true };

  const rows = (data ?? []) as Record<string, unknown>[];
  const byMode = rows.reduce<Record<string, number>>((acc, row) => {
    const key = String(row["mode"] ?? "unknown");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const payload = {
    count: rows.length,
    mode_filter: mode ?? "all",
    accounts_by_mode: byMode,
    provenance:
      "broker-derived: balance, equity, free margin, margin level, leverage and trade permission as the broker last reported them at broker_observed_at. Label, intent and mode are the user's own configuration.",
    notes: {
      demo_and_live:
        "Demo and live accounts are both returned. Always say which mode a figure belongs to — a demo result is not a live track record.",
      staleness:
        "If broker_observed_at is old, the balance and equity are old. Say so rather than presenting them as current.",
      privacy:
        "These are the signed-in user's own accounts. Never discuss another user's accounts, balances or equity; they are not readable here.",
      empty:
        "Zero rows means this user has no account matching this filter — never that the platform has no accounts.",
    },
    accounts: rows,
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

export default defineTool({
  name: "list_my_accounts",
  title: "List my connected broker accounts",
  description:
    "The signed-in user's own connected broker accounts — DEMO and LIVE — with mode, phase, intent, broker and server, masked login, currency, broker-reported balance, equity, free margin, margin level, leverage, trade permission, connection and provisioning state, benchmark flag, emergency stop or stand-down reason, and when the broker figures were last observed. Use it to resolve which account a trade or automatic order belongs to and to answer questions about demo accounts. Broker-derived; always name the mode, and never mix a demo result into a live track record.",
  inputSchema: {
    mode: z
      .enum(["demo", "live", "all"])
      .optional()
      .describe("Filter by account mode. Defaults to all."),
    include_disconnected: z
      .boolean()
      .optional()
      .describe("Include accounts the user has disconnected. Defaults to false."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    return runListMyAccounts(supabaseForUser(ctx), input);
  },
});
