/**
 * Event-driven execution reconciliation.
 *
 * The cron worker stays exactly as it is — this is not a replacement for it, it
 * is the same bounded pass invoked at the moments where waiting for the next
 * cron tick is the difference between an order and no order:
 *
 *  - the owner armed an account
 *  - the owner saved execution-relevant settings
 *  - a broker connection reconciled or reconnected successfully
 *
 * It runs the SAME authoritative enqueue stack (`reconcileActiveSignals`), so it
 * can create no order that the ordinary path would refuse, and it leaves the
 * same decision trail. It never throws into the caller: a failed reconciliation
 * must not fail the user's action that triggered it, and the cron pass will pick
 * the same work up regardless.
 */
import { reconcileActiveSignals } from "./reconcile-active.server";

/** Tighter than the cron bound: an interactive trigger stays cheap. */
export const EVENT_RECONCILE_MAX_SIGNALS = 10;

export type ReconcileEvent =
  "account_armed" | "settings_saved" | "account_reconciled" | "auto_trading_enabled";

export async function reconcileAfterEvent(event: ReconcileEvent): Promise<void> {
  try {
    const { adminClient } = await import("@/lib/scanner/pipeline.server");
    const outcome = await reconcileActiveSignals(
      adminClient(),
      Date.now(),
      EVENT_RECONCILE_MAX_SIGNALS,
    );
    console.info("[reconcile-event]", event, {
      considered: outcome.considered,
      enqueued: outcome.enqueued,
      filtered: outcome.filtered,
    });
  } catch (err) {
    console.error("[reconcile-event] failed", event, err instanceof Error ? err.message : err);
  }
}
