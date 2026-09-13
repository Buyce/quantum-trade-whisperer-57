import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";
import { brakesConfigured, readBrakeLimits } from "@/lib/risk/brakes";

/**
 * Whether the caller's automatic orders are currently held by a risk brake.
 *
 * This is a READ of the persisted brake state, which is computed from CLOSED
 * broker trades and the broker's own equity reading. It decides nothing and
 * writes nothing.
 *
 * Two honesty rules, both mirroring the terminal:
 *   - A stored hold is only reported while the user's protection is still
 *     configured. Switching the brakes off releases the queue immediately, so
 *     continuing to announce the old pause would be untrue.
 *   - If the state cannot be read, the answer is UNKNOWN. It is never "not
 *     held": silence is not proof that no risk exists.
 */
/** Shared body — the MCP handler and the in-app assistant call this same code. */
export async function runGetRiskHolds(supabase: unknown, userId: string) {
  const db = supabase as ReturnType<typeof supabaseForUser>;
  const [holdsRead, settingsRead] = await Promise.all([
    db
      .from("account_risk_state")
      .select(
        "account_id, paused, pause_reason, pause_detail, paused_at, resume_after, resume_boundary, computed_at, consecutive_losses, cancelled_matching_orders, unconfirmed_matching_orders",
      )
      .eq("paused", true),
    db
      .from("scanner_settings")
      .select(
        "drawdown_brakes_enabled, daily_loss_limit_percent, weekly_loss_limit_percent, consecutive_loss_limit, consecutive_loss_pause_hours, max_drawdown_percent",
      )
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  // Unreadable state is reported as unknown rather than resolved either way.
  if (holdsRead.error || settingsRead.error) {
    const payload = {
      status: "unknown" as const,
      reason: (holdsRead.error ?? settingsRead.error)?.message ?? "risk state could not be read",
      holds: [],
      notes: {
        unknown:
          "The brake state could not be read, so this is NOT a statement that automatic orders are unheld. Do not tell the user they are trading normally.",
      },
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      structuredContent: payload,
      isError: true,
    };
  }

  const settings = settingsRead.data as Record<string, unknown> | null;
  const configured = settings !== null && brakesConfigured(readBrakeLimits(settings));

  const holds = configured
    ? ((holdsRead.data ?? []) as Record<string, unknown>[]).map((row) => ({
        account_id: String(row["account_id"]),
        reason: (row["pause_reason"] as string | null) ?? null,
        detail: (row["pause_detail"] as string | null) ?? null,
        started_at: (row["paused_at"] as string | null) ?? null,
        lifts_after: (row["resume_after"] as string | null) ?? null,
        lifts_at_boundary: (row["resume_boundary"] as string | null) ?? null,
        measured_at: (row["computed_at"] as string | null) ?? null,
        consecutive_losses:
          row["consecutive_losses"] === null ? null : Number(row["consecutive_losses"]),
        cancelled_matching_orders: Number(row["cancelled_matching_orders"] ?? 0),
        unconfirmed_matching_orders: Number(row["unconfirmed_matching_orders"] ?? 0),
      }))
    : [];

  const payload = {
    status: configured
      ? holds.length > 0
        ? ("held" as const)
        : ("not_held" as const)
      : ("brakes_off" as const),
    brakes_configured: configured,
    holds,
    notes: {
      scope:
        "A hold stops NEW automatic orders only. Stops, targets, open positions and orders already resting at the broker are untouched.",
      provenance:
        "Measured from closed broker trades and the broker's own equity reading. Never an estimate and never a forecast.",
      brakes_off:
        "brakes_off means this user's protection is switched off, so no stored pause applies — it is not a claim that no losses occurred.",
      cancellations:
        "cancelled_matching_orders counts broker-CONFIRMED cancellations of still-unfilled orders on the same instrument and direction when a losing-run pause began. unconfirmed_matching_orders were not confirmed by the broker and may still be live.",
    },
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

export default defineTool({
  name: "get_risk_holds",
  title: "Get my risk holds",
  description:
    "Read whether the signed-in user's automatic orders are currently held by one of their own risk brakes (daily or weekly closed loss, losing run, peak-equity drawdown), which rule caused it, when the hold started, when it lifts, and how many matching unfilled orders the pause cancelled at the broker (broker-confirmed versus unconfirmed). Every value is measured from closed broker trades and the broker's own equity reading — never estimated. A hold stops NEW automatic orders only; orders and positions already at the broker are untouched. If the state cannot be read, the answer is 'unknown', never 'not held'.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    return runGetRiskHolds(supabaseForUser(ctx), ctx.getUserId() as string);
  },
});
