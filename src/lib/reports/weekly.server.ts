/**
 * Weekly shadow-report aggregation. Server-only: the shadow tables are
 * service-role gated, so all reads run through an admin client.
 *
 * ZERO-HALLUCINATION: reads live rows only. An empty week returns zeroes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTIVE_MODEL_VERSION } from "@/lib/versioning";
import { REPLAY_V1_VERSION } from "@/lib/execution/replay-registry";
import { buildReport, isoWeekKey, type ShadowRow, type WeeklyReport } from "./weekly";

export const REPORT_WINDOW_DAYS = 7;

/**
 * Rows detected inside the window. Enrolment is counted on detection so the
 * "enrolled vs resolved" split reflects the week's own output.
 */
export async function loadWeeklyReport(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<WeeklyReport> {
  const windowEnd = now;
  const windowStart = new Date(now.getTime() - REPORT_WINDOW_DAYS * 86_400_000);

  const { data, error } = await db
    // The production view IS the isolation boundary: research-candidate rows
    // are not reachable from here at all, not merely filtered out.
    .from("shadow_executions_production")
    .select("grade, status, resolved_outcome, realized_r, filled_at, miss_distance_atr")
    // Production model only: a research model's replays must never be reported
    // as the engine's weekly performance.
    .eq("model_version", ACTIVE_MODEL_VERSION)
    // Production replay labeller only: Replay-V2 research siblings share the
    // same plan and would double-count the week.
    .eq("replay_version", REPLAY_V1_VERSION)
    .gte("detected_at", windowStart.toISOString())
    .lte("detected_at", windowEnd.toISOString());
  if (error) throw new Error(error.message);

  return buildReport({
    rows: (data ?? []) as unknown as ShadowRow[],
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    generatedAt: now.toISOString(),
  });
}

const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const r = (v: number | null) =>
  v === null ? "n/a" : `${v >= 0 ? "" : "-"}${Math.abs(v).toFixed(2)}R`;

/** Flattens the report into the primitives the email template renders. */
export function reportEmailData(report: WeeklyReport): Record<string, unknown> {
  const tier = (t: WeeklyReport["high"]) => ({
    label: t.label,
    enrolled: t.enrolled,
    resolved: t.resolved,
    filled: t.filled,
    wins: t.wins,
    losses: t.losses,
    neverFilled: t.neverFilled,
    expired: t.expired,
    fillRate: pct(t.fillRate),
    winRate: pct(t.winRate),
    meanR: r(t.meanR),
    totalR: r(t.totalR),
    expectancyR: r(t.expectancyR),
    medianMissAtr: t.medianMissAtr === null ? "n/a" : `${t.medianMissAtr.toFixed(2)} ATR`,
  });

  return {
    isoWeek: report.isoWeek,
    windowStart: report.windowStart.slice(0, 10),
    windowEnd: report.windowEnd.slice(0, 10),
    totalResolved: report.totalResolved,
    high: tier(report.high),
    low: tier(report.low),
    comparisons: report.comparisons.map((c) => ({
      label: c.label,
      highRate: pct(c.highRate),
      lowRate: pct(c.lowRate),
      highN: c.highN,
      lowN: c.lowN,
      difference: c.difference === null ? "n/a" : `${(c.difference * 100).toFixed(1)} pts`,
      z: c.z === null ? "n/a" : c.z.toFixed(3),
      pValue: c.pValue === null ? "n/a" : c.pValue.toFixed(4),
      verdict: c.verdict,
      note: c.note,
    })),
  };
}

export interface WeeklyReportSendResult {
  claimed: boolean;
  sent: boolean;
  isoWeek: string;
  reason?: string;
  report: WeeklyReport;
}

/**
 * Claim-then-send: the latch is a conditional insert, so a retry inside the
 * same ISO week is a no-op. A send failure releases the latch so the next run
 * retries instead of losing the week's report.
 */
export async function sendWeeklyReport(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<WeeklyReportSendResult> {
  const report = await loadWeeklyReport(db, now);
  const week = isoWeekKey(now);

  const { data: claimed, error: claimError } = await db.rpc("claim_weekly_report", { _week: week });
  if (claimError) throw new Error(claimError.message);
  if (!claimed) {
    return { claimed: false, sent: false, isoWeek: week, reason: "already_sent_this_week", report };
  }

  try {
    const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
    const result = await sendTemplateEmail("weekly-shadow-report", "", {
      idempotencyKey: `weekly-shadow-report-${week}`,
      templateData: reportEmailData(report),
    });
    return {
      claimed: true,
      sent: result.sent,
      isoWeek: week,
      ...(result.sent ? {} : { reason: result.reason }),
      report,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[weekly-report] send failed, releasing latch:", message);
    await db.rpc("release_weekly_report", { _week: week });
    return { claimed: true, sent: false, isoWeek: week, reason: message, report };
  }
}
