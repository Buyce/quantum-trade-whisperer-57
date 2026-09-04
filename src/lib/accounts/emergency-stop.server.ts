/**
 * Customer emergency stop.
 *
 * ONE deliberate act by the account owner that:
 *  1. records the stop on every one of their connected accounts, with the time
 *     and the reason, and
 *  2. sets every one of those accounts back to `observe`, so no further
 *     automatic order can be enqueued for them, and
 *  3. cancels every automatic order of theirs that P-Trades can still cancel by
 *     itself — the rows that have not yet been claimed or sent.
 *
 * What it deliberately does NOT do is claim anything about orders that already
 * reached the broker. A `sent`, `acknowledged` or `unknown` delivery may already
 * be resting or filled at the broker; P-Trades cannot make that untrue by
 * writing a row, so those are reported back as "already at your broker" and the
 * owner is told to close them in their platform. Re-arming afterwards is always
 * deliberate and per account, through the ordinary arming path, which re-checks
 * the emergency stop.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Deliveries P-Trades can still cancel on its own authority. */
const CANCELLABLE_STATES = ["pending", "awaiting_confirmation"] as const;
/** Deliveries that may already exist at the broker; never silently rewritten. */
const AT_BROKER_STATES = ["claimed", "sent", "acknowledged", "unknown"] as const;

export interface EmergencyStopResult {
  stoppedAt: string;
  accountsStopped: number;
  accountsDisarmed: number;
  ordersCancelled: number;
  /** Orders that may already exist at the broker and were left untouched. */
  ordersAtBroker: number;
}

export async function engageEmergencyStop(
  userId: string,
  reason: string,
): Promise<EmergencyStopResult> {
  const stoppedAt = new Date().toISOString();
  const detail = reason.trim() || "Owner activated the emergency stop";

  const { data: accountRows, error: accountError } = await supabaseAdmin
    .from("connected_trading_accounts")
    .select("id, mode")
    .eq("user_id", userId)
    .is("disconnected_at", null);
  if (accountError) throw new Error(accountError.message);
  const accounts = (accountRows ?? []) as { id: string; mode: string }[];

  if (accounts.length > 0) {
    const { error } = await supabaseAdmin
      .from("connected_trading_accounts")
      .update({
        mode: "observe",
        emergency_stop_at: stoppedAt,
        emergency_stop_reason: detail,
      } as never)
      .eq("user_id", userId)
      .is("disconnected_at", null);
    if (error) throw new Error(error.message);
  }

  // Cancel what is genuinely still ours to cancel.
  const { data: cancelled, error: cancelError } = await supabaseAdmin
    .from("execution_deliveries")
    .update({
      state: "expired",
      reason: "cancelled_by_emergency_stop",
      settled_at: stoppedAt,
    } as never)
    .eq("user_id", userId)
    .in("state", CANCELLABLE_STATES as unknown as string[])
    .select("id");
  if (cancelError) throw new Error(cancelError.message);

  // Count, but never rewrite, what may already exist at the broker.
  const { count: atBroker } = await supabaseAdmin
    .from("execution_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("state", AT_BROKER_STATES as unknown as string[])
    .is("settled_at", null);

  return {
    stoppedAt,
    accountsStopped: accounts.length,
    accountsDisarmed: accounts.filter((a) => a.mode !== "observe").length,
    ordersCancelled: (cancelled ?? []).length,
    ordersAtBroker: atBroker ?? 0,
  };
}

/**
 * Clear the stop on ONE account. Clearing it does not re-arm anything: the
 * account stays in `observe` until the owner arms it again explicitly, which
 * re-runs every broker and system gate.
 */
export async function releaseEmergencyStop(userId: string, accountId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("connected_trading_accounts")
    .update({ emergency_stop_at: null, emergency_stop_reason: null } as never)
    .eq("user_id", userId)
    .eq("id", accountId);
  if (error) throw new Error(error.message);
}
