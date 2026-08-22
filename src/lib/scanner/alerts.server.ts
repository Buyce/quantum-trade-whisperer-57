import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTemplateEmail } from "@/lib/email-templates/send-email";
import { ORDER_TIF_MINUTES } from "@/lib/db-types";
import { sendPushToUsers } from "./push.server";

import {
  buildCapFrame,
  evaluateEligibility,
  type EligibilitySettings,
  type EligibilitySignal,
} from "@/lib/delivery/eligibility";
import { fetchDayFrame, type FrameClient } from "@/lib/delivery/day-frame";
import type { Grade } from "@/lib/db-types";

export interface AlertSignal {
  id: string;
  instrument: string;
  grade: string;
  direction: string;
  entryPrice: number;
  /** Slippage ceiling — printed in the email and the push body. */
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
  daily_setup_cap: number | null;
  notify_email: boolean | null;
  notify_push: boolean | null;
}

/**
 * Fans a freshly published signal out to each user whose scanner settings accept
 * it: a branded email when email alerts are on and a push notification when push
 * is on. Email sends are keyed to the signal id so worker retries never
 * duplicate.
 *
 * This path is NOTIFICATION-ONLY. It never emits a broker instruction: every
 * execution-capable delivery goes exclusively through the Prompt-13 control
 * plane (execution_deliveries → claim → revalidate → quantity → SSRF →
 * signature → dispatch). `webhook_enabled` alone can never place a trade.
 */
export async function sendSignalAlerts(db: SupabaseClient, signal: AlertSignal) {
  const { data: rows, error } = await db
    .from("scanner_settings")
    .select(
      "user_id, instruments, sessions, alert_min_grade, daily_setup_cap, notify_email, notify_push",
    )
    .or("notify_email.eq.true,notify_push.eq.true");
  if (error || !rows?.length) return;

  const now = Date.now();
  const target: EligibilitySignal = {
    id: signal.id,
    detected_at: new Date(now).toISOString(),
    instrument: signal.instrument,
    grade: signal.grade as Grade,
    trading_session: signal.session,
  };

  // The COMPLETE UTC-day frame. The per-user cap is derived from each user's own
  // base-eligible sequence, never from a global count of every published signal:
  // a London-only Gold trader must not lose allowance to Tokyo EURUSD setups.
  // An unreadable frame must not silently understate consumption, so on error we
  // fall back to the single target signal (cap effectively unlimited for this
  // publish) rather than to a wrong count.
  let frame: EligibilitySignal[] = [target];
  try {
    const fetched = await fetchDayFrame(db as unknown as FrameClient, now);
    frame = fetched.some((s) => s.id === target.id) ? fetched : [...fetched, target];
  } catch (err) {
    console.error("alert eligibility frame unavailable", err);
  }

  const pushUserIds: string[] = [];

  for (const row of rows as SettingsRow[]) {
    const alertGrade = (row.alert_min_grade ?? "B") as Grade;
    const settings: EligibilitySettings = {
      instruments: row.instruments ?? [],
      sessions: row.sessions ?? [],
      // The alert channel is gated by `alert_min_grade`; `min_grade` belongs to
      // the feed and is deliberately not consulted here.
      min_grade: alertGrade,
      alert_min_grade: alertGrade,
      daily_setup_cap: row.daily_setup_cap ?? 0,
    };
    const cappedOutIds = buildCapFrame(frame, settings, "alert", now);
    const verdict = evaluateEligibility({
      signal: target,
      settings,
      channel: "alert",
      now,
      cappedOutIds,
    });
    if (!verdict.eligible) continue;


    if (row.notify_push) pushUserIds.push(row.user_id);

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

  // Push first: it is the lowest-latency channel and the one the trader acts on.
  try {
    await sendPushToUsers(db, pushUserIds, {
      title: `${signal.grade} · ${signal.instrument} ${signal.direction === "long" ? "LONG" : "SHORT"}`,
      body: `Entry ${fmt(signal.entryPrice)} · max ${fmt(signal.maxAcceptableEntry)} · SL ${fmt(
        signal.stopLoss,
      )} · R:R 1:${signal.rrRatio.toFixed(1)} · valid ${ORDER_TIF_MINUTES}m`,
      url: "/feed",
      tag: `signal-${signal.id}`,
    });
  } catch (err) {
    console.error("signal push send failed", err);
  }

}
