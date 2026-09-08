/**
 * Scanner starvation watch.
 *
 * The seven-hour outage that motivated this module was invisible because every
 * queue job still closed as `done`: each one had aged past its freshness limit
 * and was discarded BEFORE any candle was fetched. Job counters therefore looked
 * healthy while the strategy ran on nothing.
 *
 * This watcher reads the same measured window the admin panel reads, opens ONE
 * incident per outage (latched in the database, so a 15-minute cron cannot mail
 * repeatedly), and closes it as soon as real analysis resumes. It never derives
 * or fills in a figure: every number quoted comes from `get_admin_engine_status`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyScanStarvation } from "@/lib/engine-status";
import { isWeekendClosed } from "@/lib/market-hours";

export interface StarvationWatchOutcome {
  checked: boolean;
  starved: boolean;
  incidentOpened: boolean;
  notified: boolean;
  cleared: boolean;
  reason?: string;
}

const utcMinute = (iso: unknown): string =>
  typeof iso === "string" ? `${new Date(iso).toISOString().replace("T", " ").slice(0, 16)} UTC` : "unknown";

/**
 * Best-effort by construction: a health-notification failure must never fail the
 * scan cycle that called it, so every path returns an outcome instead of throwing.
 */
export async function runStarvationWatch(db: SupabaseClient): Promise<StarvationWatchOutcome> {
  const idle: StarvationWatchOutcome = {
    checked: false,
    starved: false,
    incidentOpened: false,
    notified: false,
    cleared: false,
  };

  try {
    const { data, error } = await db.rpc("get_admin_engine_status");
    if (error) return { ...idle, reason: error.message };

    const status = data as {
      scan?: {
        window_minutes?: number;
        total?: number;
        stale?: number;
        analysed?: number;
        last_analysed_at?: string | null;
        last_candle_fetch_at?: string | null;
      } | null;
      link?: {
        ok?: number;
        failed?: number;
        last_failure_detail?: string | null;
      } | null;
    } | null;

    const scan = status?.scan;
    if (!scan) return { ...idle, reason: "no scan window reported" };

    const starvation = classifyScanStarvation({
      total: Number(scan.total ?? 0),
      stale: Number(scan.stale ?? 0),
      analysed: Number(scan.analysed ?? 0),
      weekendClosed: isWeekendClosed(new Date()),
    });

    // Recovery first: analysis resuming closes any open incident, so the next
    // outage is a fresh notification rather than a suppressed one.
    if (!starvation.isFault) {
      const { data: cleared } = await db.rpc("clear_starvation_incident");
      return { ...idle, checked: true, cleared: cleared === true };
    }

    const { data: incidentId, error: claimError } = await db.rpc("claim_starvation_incident", {
      _stale: Number(scan.stale ?? 0),
      _analysed: Number(scan.analysed ?? 0),
      _detail: starvation.value,
    });
    if (claimError) {
      return { ...idle, checked: true, starved: true, reason: claimError.message };
    }
    // No id = an incident is already open and was already reported.
    if (typeof incidentId !== "number") {
      return { ...idle, checked: true, starved: true };
    }

    const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
    const { sent } = await sendTemplateEmail("scanner-starved", "", {
      idempotencyKey: `scanner-starved-${incidentId}`,
      templateData: {
        stale: Number(scan.stale ?? 0),
        analysed: Number(scan.analysed ?? 0),
        windowMinutes: Number(scan.window_minutes ?? 60),
        lastAnalysedAt: utcMinute(scan.last_analysed_at),
        lastCandleFetchAt: utcMinute(scan.last_candle_fetch_at),
        linkOk: status?.link?.ok ?? undefined,
        linkFailed: status?.link?.failed ?? undefined,
        linkDetail: status?.link?.last_failure_detail ?? undefined,
        openedAt: utcMinute(new Date().toISOString()),
      },
    });
    if (sent) await db.rpc("mark_starvation_notified", { _id: incidentId });

    return { checked: true, starved: true, incidentOpened: true, notified: sent, cleared: false };
  } catch (err) {
    return { ...idle, reason: err instanceof Error ? err.message : String(err) };
  }
}
