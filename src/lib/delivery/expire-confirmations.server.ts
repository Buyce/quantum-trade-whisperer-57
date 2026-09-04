/**
 * Confirmation-window sweeper.
 *
 * A live order request that the owner did not answer inside its window is
 * settled as `expired`. It is never carried forward and never submitted later:
 * consent given after the window would be consent for a setup that no longer
 * exists at that price.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient<never>;

export async function expireUnansweredConfirmations(
  db: Db,
  nowMs: number = Date.now(),
): Promise<number> {
  const now = new Date(nowMs).toISOString();
  const { data, error } = await db
    .from("execution_deliveries")
    .update({
      state: "expired",
      reason: "confirmation_window_passed",
      settled_at: now,
    } as never)
    .eq("state", "awaiting_confirmation")
    .not("confirmation_expires_at", "is", null)
    .lte("confirmation_expires_at", now)
    .select("id");
  if (error) {
    console.error("[confirmations] expiry failed", error.message);
    return 0;
  }
  return (data ?? []).length;
}
