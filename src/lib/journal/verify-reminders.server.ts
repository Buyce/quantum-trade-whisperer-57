/**
 * Fill-price verification reminders.
 *
 * Finds closed trades (win/loss/breakeven) that the user logged without the
 * actual entry and exit price they got, then nudges that user once per ISO week
 * by email and web push so the R multiple can be derived from real prices.
 *
 * Server-only: reads across users with the service-role client and pulls the
 * recipient address from the auth admin API.
 *
 * ZERO-HALLUCINATION: reads live rows only. No trades, no reminders.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToUsers } from "@/lib/scanner/push.server";

/** How many trades are listed in the email body. */
export const EMAIL_TRADE_SAMPLE = 5;
const HISTORY_URL = "https://getptrades.com/history";

export interface UnverifiedTradeRow {
  id: string;
  user_id: string;
  outcome: string;
  created_at: string;
  scanned_signals: { instrument: string; direction: string } | { instrument: string; direction: string }[] | null;
}

export interface UserReminder {
  userId: string;
  missingCount: number;
  trades: { instrument: string; direction: string; outcome: string; date: string }[];
}

export interface ReminderOutcome {
  userId: string;
  missingCount: number;
  claimed: boolean;
  emailSent: boolean;
  pushSent: number;
  reason?: string;
}

/** ISO-week key, matching the weekly report's latch format. */
export function isoWeek(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function signalOf(row: UnverifiedTradeRow) {
  const s = row.scanned_signals;
  const one = Array.isArray(s) ? s[0] : s;
  return one ?? null;
}

/**
 * Closed trades missing either price, grouped by owner. A trade whose signal
 * row has already been purged is skipped: without the signal there is nothing
 * to verify against.
 */
export async function loadUnverifiedByUser(db: SupabaseClient): Promise<UserReminder[]> {
  const { data, error } = await db
    .from("executed_trades")
    .select("id, user_id, outcome, created_at, scanned_signals(instrument, direction)")
    .eq("user_decision", "taken")
    .neq("outcome", "open")
    .or("actual_entry_price.is.null,actual_exit_price.is.null")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const byUser = new Map<string, UserReminder>();
  for (const raw of (data ?? []) as unknown as UnverifiedTradeRow[]) {
    const signal = signalOf(raw);
    if (!signal) continue;
    const entry =
      byUser.get(raw.user_id) ?? { userId: raw.user_id, missingCount: 0, trades: [] };
    entry.missingCount += 1;
    if (entry.trades.length < EMAIL_TRADE_SAMPLE) {
      entry.trades.push({
        instrument: signal.instrument,
        direction: signal.direction,
        outcome: raw.outcome,
        date: new Date(raw.created_at).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        }),
      });
    }
    byUser.set(raw.user_id, entry);
  }

  return [...byUser.values()];
}

/**
 * Claim-then-send per user: the weekly latch is a conditional insert, so a
 * retry inside the same week is a no-op. A send failure releases that user's
 * latch only, and never aborts the remaining users.
 */
export async function sendVerifyReminders(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<{ week: string; candidates: number; results: ReminderOutcome[] }> {
  const week = isoWeek(now);
  const candidates = await loadUnverifiedByUser(db);
  const results: ReminderOutcome[] = [];

  for (const candidate of candidates) {
    const outcome: ReminderOutcome = {
      userId: candidate.userId,
      missingCount: candidate.missingCount,
      claimed: false,
      emailSent: false,
      pushSent: 0,
    };

    try {
      const { data: claimed, error: claimError } = await db.rpc("claim_verify_reminder", {
        _user_id: candidate.userId,
        _week: week,
        _missing: candidate.missingCount,
      });
      if (claimError) throw new Error(claimError.message);
      if (!claimed) {
        outcome.reason = "already_reminded_this_week";
        results.push(outcome);
        continue;
      }
      outcome.claimed = true;

      const { data: authUser } = await db.auth.admin.getUserById(candidate.userId);
      const email = authUser?.user?.email ?? null;

      if (email) {
        const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
        const sent = await sendTemplateEmail("verify-trade-prices", email, {
          idempotencyKey: `verify-trade-prices-${candidate.userId}-${week}`,
          templateData: {
            missingCount: candidate.missingCount,
            trades: candidate.trades,
            historyUrl: HISTORY_URL,
          },
        });
        outcome.emailSent = sent.sent;
        if (!sent.sent) outcome.reason = sent.reason;
      } else {
        outcome.reason = "no_email_on_file";
      }

      const push = await sendPushToUsers(db, [candidate.userId], {
        title: "Verify your trades",
        body:
          candidate.missingCount === 1
            ? "1 logged trade is missing its fill prices — tap to add them."
            : `${candidate.missingCount} logged trades are missing fill prices — tap to add them.`,
        url: "/history",
        tag: `verify-prices-${week}`,
      });
      outcome.pushSent = push.sent;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[verify-reminders] failed for user:", message);
      outcome.reason = message;
      if (outcome.claimed) {
        await db
          .rpc("release_verify_reminder", { _user_id: candidate.userId, _week: week })
          .then(() => undefined, () => undefined);
      }
    }

    results.push(outcome);
  }

  return { week, candidates: candidates.length, results };
}
