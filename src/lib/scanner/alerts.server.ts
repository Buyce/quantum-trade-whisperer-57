import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTemplateEmail } from "@/lib/email-templates/send-email";
import { ORDER_TIF_MINUTES } from "@/lib/db-types";
import { dispatchWebhooks, type WebhookTarget } from "./webhook.server";

const GRADE_RANK: Record<string, number> = { "A+": 4, A: 3, B: 2, C: 1 };

export interface AlertSignal {
  id: string;
  instrument: string;
  grade: string;
  direction: string;
  entryPrice: number;
  /** Slippage ceiling — printed in the email and sent to webhooks. */
  maxAcceptableEntry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number | null;
  tp1R?: number;
  tp2R?: number;
  tp3R?: number | null;
  rrRatio: number;
  confidence: number;
  breakdown: string;
  session: string;
}

function fmt(v: number) {
  return v >= 100 ? v.toFixed(2) : v.toFixed(5);
}

function rLabel(r: number | null | undefined, fallback: number) {
  const mult = r ?? fallback;
  return `1:${mult.toFixed(mult % 1 === 0 ? 0 : 2)}`;
}

interface SettingsRow {
  user_id: string;
  instruments: string[] | null;
  sessions: string[] | null;
  alert_min_grade: string | null;
  notify_email: boolean | null;
  webhook_enabled: boolean | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  webhook_format: string | null;
}

/**
 * Fans a freshly published signal out to each user whose scanner settings accept
 * it: a branded email when email alerts are on, and a broker webhook POST when
 * the dispatcher is enabled. Email sends are keyed to the signal id so worker
 * retries never duplicate; webhooks carry the same key in a header.
 */
export async function sendSignalAlerts(db: SupabaseClient, signal: AlertSignal) {
  const { data: rows, error } = await db
    .from("scanner_settings")
    .select(
      "user_id, instruments, sessions, alert_min_grade, notify_email, webhook_enabled, webhook_url, webhook_secret, webhook_format",
    )
    .or("notify_email.eq.true,webhook_enabled.eq.true");
  if (error || !rows?.length) return;

  const signalRank = GRADE_RANK[signal.grade] ?? 0;
  const webhookTargets: WebhookTarget[] = [];

  for (const row of rows as SettingsRow[]) {
    if (row.instruments?.length && !row.instruments.includes(signal.instrument)) continue;
    if (row.sessions?.length && !row.sessions.includes(signal.session)) continue;
    // Per-user alert threshold — no hardcoded grade muting.
    if (signalRank < (GRADE_RANK[row.alert_min_grade ?? "B"] ?? 2)) continue;

    if (row.webhook_enabled && row.webhook_url) {
      webhookTargets.push({
        userId: row.user_id,
        url: row.webhook_url,
        secret: row.webhook_secret,
        format: row.webhook_format === "pineconnector" ? "pineconnector" : "json",
      });
    }

    if (!row.notify_email) continue;

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
          maxAcceptableEntry: fmt(signal.maxAcceptableEntry),
          stopLoss: fmt(signal.stopLoss),
          tp1: fmt(signal.tp1),
          tp2: fmt(signal.tp2),
          tp3: signal.tp3 === null ? "—" : fmt(signal.tp3),
          tp1Label: rLabel(signal.tp1R, 1),
          tp2Label: rLabel(signal.tp2R, 2),
          tp3Label: signal.tp3 === null ? "" : rLabel(signal.tp3R, 3),
          orderType: signal.direction === "long" ? "BUY LIMIT" : "SELL LIMIT",
          tifMinutes: String(ORDER_TIF_MINUTES),
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

  // Dispatch last, after the signal is already committed: a hung broker bridge
  // can cost one 5s timeout and nothing else.
  await dispatchWebhooks(
    {
      id: signal.id,
      instrument: signal.instrument,
      grade: signal.grade,
      direction: signal.direction,
      entryPrice: signal.entryPrice,
      maxAcceptableEntry: signal.maxAcceptableEntry,
      stopLoss: signal.stopLoss,
      tp1: signal.tp1,
      tp2: signal.tp2,
      tp3: signal.tp3,
      rrRatio: signal.rrRatio,
      confidence: signal.confidence,
      tifMinutes: ORDER_TIF_MINUTES,
    },
    webhookTargets,
  );
}
