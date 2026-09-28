/**
 * Shared bodies for the v0.9 AI tools. Both the MCP server (ChatGPT, Claude,
 * Gemini, any MCP client) and the in-app assistant call these same functions
 * with the caller's own RLS-scoped client — there is no second implementation.
 *
 * [INVARIANT] Nothing here writes broker orders. Proposal tools only INSERT a
 * pending row into ai_action_proposals; the change runs later, only when the
 * user taps Approve in P-Trades (src/lib/ai-tools/proposals.functions.ts).
 */
import { z } from "zod";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export const APP_ORIGIN = "https://getptrades.com";

export type Envelope = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export function envelope(payload: unknown, isError = false): Envelope {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload as Record<string, unknown>,
    ...(isError ? { isError: true } : {}),
  };
}

function fail(message: string) {
  return envelope({ error: message }, true);
}

/** Risk policy per connected account. "Not set" means automatic orders stay blocked. */
export async function runGetRiskPolicy(db: Db, userId: string, input: { account_id?: string | undefined }) {
  let accounts = db
    .from("connected_trading_accounts")
    .select("id, label, broker_account_type, account_mode, disconnected_at")
    .eq("user_id", userId);
  if (input.account_id) accounts = accounts.eq("id", input.account_id);
  const [acc, pol] = await Promise.all([
    accounts,
    db
      .from("connected_account_risk_policies")
      .select(
        "account_id, policy_kind, starting_balance, operating_risk_per_trade_percent, hard_risk_per_trade_percent, max_daily_loss_percent, max_total_loss_percent, trailing_drawdown, max_trades_per_day, daily_profit_objective, news_trading_allowed, updated_at",
      )
      .eq("user_id", userId),
  ]);
  if (acc.error || pol.error) return fail((acc.error ?? pol.error).message);
  const byId = new Map((pol.data ?? []).map((p: { account_id: string }) => [p.account_id, p]));
  return envelope({
    accounts: (acc.data ?? [])
      .filter((a: { disconnected_at: string | null }) => !a.disconnected_at)
      .map((a: Record<string, unknown>) => ({
        account_id: a["id"],
        label: a["label"],
        account_type: a["broker_account_type"],
        mode: a["account_mode"],
        policy: byId.get(a["id"] as string) ?? null,
      })),
    notes: {
      not_set:
        "policy null means no risk policy is set — automatic orders stay blocked on that account until the user sets one on the Accounts page.",
      provenance: "User-entered on the Accounts page.",
    },
  });
}

/** Open broker-vs-platform mismatches flagged by the scheduled reconciliation. */
export async function runListReviewItems(
  db: Db,
  userId: string,
  input: { include_resolved?: boolean | undefined },
) {
  let q = db
    .from("reconciliation_discrepancies")
    .select(
      "id, connected_account_id, kind, ref, severity, summary, platform_value, broker_value, status, first_seen_at, last_seen_at, acknowledged_at, resolved_at",
    )
    .eq("user_id", userId)
    .order("last_seen_at", { ascending: false })
    .limit(50);
  if (!input.include_resolved) q = q.is("resolved_at", null);
  const { data, error } = await q;
  if (error) return fail(error.message);
  return envelope({
    items: data ?? [],
    notes: {
      meaning:
        "Each item is a mismatch between the broker and P-Trades records. Nothing is corrected automatically. An empty list means no mismatch is currently flagged, measured only when the broker could be read.",
    },
  });
}

/** Unfilled orders P-Trades placed that are still waiting at the broker. */
export async function runListRestingOrders(db: Db, userId: string) {
  const { data, error } = await db
    .from("execution_deliveries")
    .select(
      "id, connected_account_id, account_mode, broker_symbol, entry_mode, state, broker_order_state, submitted_volume, submitted_entry, submitted_stop, submitted_target, submitted_at, enqueued_at",
    )
    .eq("user_id", userId)
    .in("state", ["pending", "claimed", "sent", "acknowledged"])
    .order("enqueued_at", { ascending: false })
    .limit(50);
  if (error) return fail(error.message);
  return envelope({
    orders: data ?? [],
    notes: {
      resting:
        "These orders are waiting and have NOT filled. They can be cancelled only through propose_cancel_order plus the user's approval in P-Trades.",
    },
  });
}

/** Per instrument/direction automatic-trading policies (allow / reduce / block). */
export async function runGetCohortPolicies(db: Db, userId: string) {
  const { data, error } = await db
    .from("auto_cohort_policies")
    .select("instrument, direction, policy, risk_share_percent, updated_at")
    .eq("user_id", userId)
    .order("instrument");
  if (error) return fail(error.message);
  return envelope({
    policies: data ?? [],
    notes: {
      default: "Any instrument/direction not listed is Allow at full normal risk.",
      scope: "Affects automatic orders only — never the feed, alerts, grading or statistics.",
    },
  });
}

/** Upcoming high-impact economic events (the news blackout calendar). */
export async function runListNewsBlackouts(
  db: Db,
  input: { hours?: number | undefined; instrument?: string | undefined },
) {
  const hours = Math.min(Math.max(input.hours ?? 48, 1), 168);
  const now = new Date();
  let q = db
    .from("economic_events")
    .select("event_family, currencies, affected_instruments, importance, scheduled_at, event_status")
    .gte("scheduled_at", now.toISOString())
    .lte("scheduled_at", new Date(now.getTime() + hours * 3_600_000).toISOString())
    .eq("importance", "high")
    .order("scheduled_at")
    .limit(40);
  if (input.instrument) q = q.contains("affected_instruments", [input.instrument.toUpperCase()]);
  const { data, error } = await q;
  if (error) return fail(error.message);
  return envelope({
    window_hours: hours,
    events: data ?? [],
    notes: {
      source: "Ingested economic calendar provider rows. An empty list means no high-impact event matched this window.",
    },
  });
}

// ---------- proposals ----------

export const cancelProposalInput = z.object({
  delivery_id: z.number().int().positive(),
  reason: z.string().max(200).optional(),
});

export const riskPolicyProposalInput = z.object({
  account_id: z.string().uuid(),
  starting_balance: z.number().gt(0).max(100_000_000),
  operating_risk_per_trade_percent: z.number().gt(0).max(5),
  hard_risk_per_trade_percent: z.number().gt(0).max(10),
  max_daily_loss_percent: z.number().gt(0).max(100).nullable().optional(),
  max_total_loss_percent: z.number().gt(0).max(100).nullable().optional(),
  trailing_drawdown: z.boolean().optional(),
  max_trades_per_day: z.number().int().min(1).max(50).nullable().optional(),
});

export const cohortProposalInput = z.object({
  instrument: z.string().min(3).max(20),
  direction: z.enum(["long", "short"]),
  policy: z.enum(["allow", "reduce", "block"]),
  risk_share_percent: z.union([z.literal(25), z.literal(50), z.literal(75)]).nullable().optional(),
});

type Kind = "cancel_order" | "risk_policy" | "cohort_policy";

async function insertProposal(
  db: Db,
  userId: string,
  kind: Kind,
  payload: unknown,
  summary: string,
  source: "in_app" | "mcp",
) {
  const { data, error } = await db
    .from("ai_action_proposals")
    .insert({ user_id: userId, kind, payload, summary, source })
    .select("id, expires_at")
    .single();
  if (error) return fail(error.message);
  return envelope({
    proposal_id: data.id,
    status: "pending_user_approval",
    summary,
    approve_url: `${APP_ORIGIN}/approvals/${data.id}`,
    expires_at: data.expires_at,
    notes: {
      nothing_changed:
        "NOTHING has changed yet. The user must open approve_url (or tap Approve in the in-app card) within 15 minutes. Tell the user exactly that.",
    },
  });
}

export async function runProposeCancelOrder(
  db: Db,
  userId: string,
  raw: unknown,
  source: "in_app" | "mcp",
) {
  const parsed = cancelProposalInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid input");
  const { data, error } = await db
    .from("execution_deliveries")
    .select("id, broker_symbol, state, account_mode, submitted_entry")
    .eq("user_id", userId)
    .eq("id", parsed.data.delivery_id)
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Order not found among your orders.");
  if (!["pending", "claimed", "sent", "acknowledged"].includes(data.state)) {
    return fail(`Order is ${data.state} — only waiting (unfilled) orders can be cancelled.`);
  }
  const summary = `Cancel waiting ${data.account_mode ?? ""} order #${data.id} on ${data.broker_symbol ?? "?"}${data.submitted_entry ? ` at ${data.submitted_entry}` : ""}`;
  return insertProposal(db, userId, "cancel_order", parsed.data, summary.replace(/\s+/g, " "), source);
}

export async function runProposeRiskPolicy(
  db: Db,
  userId: string,
  raw: unknown,
  source: "in_app" | "mcp",
) {
  const parsed = riskPolicyProposalInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid input");
  const p = parsed.data;
  if (p.operating_risk_per_trade_percent > p.hard_risk_per_trade_percent) {
    return fail("Normal risk per trade cannot be above the hard cap.");
  }
  const { data, error } = await db
    .from("connected_trading_accounts")
    .select("id, label")
    .eq("user_id", userId)
    .eq("id", p.account_id)
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Account not found among your accounts.");
  const summary = `Set risk policy on ${data.label}: ${p.operating_risk_per_trade_percent}% normal / ${p.hard_risk_per_trade_percent}% hard cap per trade${p.max_daily_loss_percent ? `, ${p.max_daily_loss_percent}% daily loss` : ""}${p.max_total_loss_percent ? `, ${p.max_total_loss_percent}% total loss` : ""}`;
  return insertProposal(db, userId, "risk_policy", p, summary, source);
}

export async function runProposeCohortPolicy(
  db: Db,
  userId: string,
  raw: unknown,
  source: "in_app" | "mcp",
) {
  const parsed = cohortProposalInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid input");
  const p = { ...parsed.data, instrument: parsed.data.instrument.toUpperCase() };
  if (p.policy === "reduce" && !p.risk_share_percent) {
    return fail("reduce needs risk_share_percent of 25, 50 or 75.");
  }
  const summary =
    p.policy === "reduce"
      ? `Reduce automatic ${p.instrument} ${p.direction} orders to ${p.risk_share_percent}% of normal risk`
      : `${p.policy === "block" ? "Block" : "Allow"} automatic ${p.instrument} ${p.direction} orders`;
  return insertProposal(db, userId, "cohort_policy", p, summary, source);
}
