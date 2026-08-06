import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTemplateEmail } from "@/lib/email-templates/send-email";

const GRADE_RANK: Record<string, number> = { "A+": 4, A: 3, B: 2, C: 1 };

export interface AlertSignal {
  id: string;
  instrument: string;
  grade: string;
  direction: string;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  rrRatio: number;
  confidence: number;
  breakdown: string;
  session: string;
}

function fmt(v: number) {
  return v >= 100 ? v.toFixed(2) : v.toFixed(5);
}

/**
 * Fans a freshly published signal out to each user whose scanner settings opted
 * into email alerts and whose filters accept it. One send per recipient, keyed
 * to the signal id so worker retries never duplicate.
 */
export async function sendSignalAlerts(db: SupabaseClient, signal: AlertSignal) {
  const { data: rows, error } = await db
    .from("scanner_settings")
    .select("user_id, instruments, sessions, alert_min_grade, notify_email")
    .eq("notify_email", true);
  if (error || !rows?.length) return;

  const signalRank = GRADE_RANK[signal.grade] ?? 0;

  for (const row of rows as Array<{
    user_id: string;
    instruments: string[] | null;
    sessions: string[] | null;
    alert_min_grade: string | null;
    }>) {
    if (row.instruments?.length && !row.instruments.includes(signal.instrument)) continue;
    if (row.sessions?.length && !row.sessions.includes(signal.session)) continue;
    // Per-user alert threshold — no hardcoded grade muting.
    if (signalRank < (GRADE_RANK[row.alert_min_grade ?? "B"] ?? 2)) continue;


    try {
      const { data: userRes } = await db.auth.admin.getUserById(row.user_id);
      const email = userRes?.user?.email;
      if (!email) continue;

      await sendTemplateEmail("signal-alert", email, {
        templateData: {
          instrument: signal.instrument,
          grade: signal.grade,
          direction: signal.direction,
          entryPrice: fmt(signal.entryPrice),
          stopLoss: fmt(signal.stopLoss),
          tp1: fmt(signal.tp1),
          tp2: fmt(signal.tp2),
          tp3: fmt(signal.tp3),
          rrRatio: `1:${signal.rrRatio.toFixed(1)}`,
          confidence: String(Math.round(signal.confidence)),
          breakdown: signal.breakdown,
          feedUrl: "https://getptrades.com/feed",
        },
        idempotencyKey: `signal-alert-${signal.id}-${row.user_id}`,
      });
    } catch (err) {
      // Alerts must never fail a scan job.
      console.error("signal alert send failed", { user: row.user_id, err });
    }
  }
}
