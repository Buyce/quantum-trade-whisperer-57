/**
 * Gate-change automation runner.
 *
 * Wraps `run_gate_change_automation()` — the single service-role path that may
 * open a *system* gate-change proposal, apply one automatically (only while the
 * owner switch is on and the strict bar is cleared), or revert an automatic
 * change whose follow-up cohort came out worse.
 *
 * This module adds only notifications on top of that RPC:
 *  - a one-time "the dataset is big enough to build the model" email, latched
 *    in the database so it sends exactly once;
 *  - one email per automatic application or revert, keyed by proposal id.
 *
 * Runs at the tail of the hourly shadow-resolve cron and is fully guarded: an
 * email or automation failure must never re-label the resolve pass as failed.
 * Every figure quoted in the mails comes from the RPC's frozen snapshot — this
 * module never derives, estimates, or fills in a statistic of its own.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EMPTY_GATE_READINESS,
  type GateReadiness,
  isTrainingReady,
  readyGates,
} from "./readiness";

export interface GateAutomationChange {
  id: string;
  gate: string;
  verdict?: string | null;
  value?: number | null;
  current_value?: number | null;
  proposed_value?: number | null;
  post_change_mean_r?: number | null;
  pre_change_mean_r?: number | null;
}

export interface GateAutomationResult {
  ok: boolean;
  auto_apply_enabled: boolean;
  readiness: GateReadiness;
  proposed: GateAutomationChange[];
  applied: GateAutomationChange[];
  reverted: GateAutomationChange[];
}

export interface GateAutomationOutcome {
  ran: boolean;
  error?: string | undefined;
  readinessEmailSent?: boolean | undefined;
  changeEmails?: { id: string; action: string; sent: boolean; reason?: string | undefined }[];
  result?: GateAutomationResult | undefined;
}

const utcMinute = (iso: string | null | undefined): string =>
  iso ? `${new Date(iso).toISOString().replace("T", " ").slice(0, 16)} UTC` : "unknown";

async function sendMail(
  template: string,
  idempotencyKey: string,
  templateData: Record<string, unknown>,
): Promise<{ sent: boolean; reason?: string | undefined }> {
  const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
  const result = await sendTemplateEmail(template, "", { idempotencyKey, templateData });
  return { sent: result.sent, reason: result.sent ? undefined : result.reason };
}

/**
 * One-time readiness notice. Claim first, send second: the claim is a
 * conditional UPDATE, so an overlapping cron run gets false and sends nothing.
 * A send failure releases the latch so the next cycle retries rather than
 * silently swallowing the only notification.
 */
async function notifyModelReadiness(
  db: SupabaseClient,
  readiness: GateReadiness,
): Promise<boolean | undefined> {
  if (!isTrainingReady(readiness)) return undefined;

  const { data: claimed, error } = await db.rpc("claim_learning_milestone", {
    _gate: "model_readiness",
  });
  if (error) {
    console.error("[gate-automation] readiness claim failed:", error.message);
    return false;
  }
  if (!claimed) return undefined; // already notified on an earlier cycle

  try {
    const { sent } = await sendMail("model-readiness", "learning-milestone-model_readiness", {
      tradingDays: readiness.trading_days,
      minTradingDays: readiness.min_trading_days,
      minSamplesPerArm: readiness.min_samples_per_arm,
      minClustersPerArm: readiness.min_clusters_per_arm,
      autoApplyEnabled: readiness.auto_apply_enabled,
      gates: readyGates(readiness).map((g) => ({
        gate: g.gate,
        verdict: g.verdict,
        currentValue: g.current_value,
        passN: g.pass_n_used,
        failN: g.fail_n_used,
        passMeanR: g.pass_mean_r,
        failMeanR: g.fail_mean_r,
      })),
      reachedAt: utcMinute(readiness.as_of),
    });
    return sent;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[gate-automation] readiness send failed, re-arming:", message);
    await db.rpc("release_learning_milestone", { _gate: "model_readiness" });
    return false;
  }
}

export async function runGateChangeAutomation(
  db: SupabaseClient,
): Promise<GateAutomationOutcome> {
  let result: GateAutomationResult;
  try {
    const { data, error } = await db.rpc("run_gate_change_automation");
    if (error) throw new Error(error.message);
    result = (data ?? {
      ok: false,
      auto_apply_enabled: false,
      readiness: EMPTY_GATE_READINESS,
      proposed: [],
      applied: [],
      reverted: [],
    }) as GateAutomationResult;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[gate-automation] run failed:", message);
    return { ran: false, error: message };
  }

  const readiness = result.readiness ?? EMPTY_GATE_READINESS;
  let readinessEmailSent: boolean | undefined;
  try {
    readinessEmailSent = await notifyModelReadiness(db, readiness);
  } catch (err) {
    console.error(
      "[gate-automation] readiness notification failed:",
      err instanceof Error ? err.message : String(err),
    );
  }

  // One mail per automatic application / revert. The idempotency key is the
  // proposal id plus the action, so a transport retry cannot duplicate it and
  // the same proposal can legitimately mail once when applied and once when
  // reverted.
  const changeEmails: NonNullable<GateAutomationOutcome["changeEmails"]> = [];
  const actions: [string, GateAutomationChange[]][] = [
    ["applied", result.applied ?? []],
    ["reverted", result.reverted ?? []],
  ];
  for (const [action, changes] of actions) {
    for (const change of changes) {
      try {
        const { sent, reason } = await sendMail(
          "gate-change-applied",
          `gate-change-${action}-${change.id}`,
          {
            action,
            gate: change.gate,
            verdict: change.verdict ?? null,
            newValue: change.value ?? change.current_value ?? null,
            previousValue: change.proposed_value ?? null,
            postChangeMeanR: change.post_change_mean_r ?? null,
            preChangeMeanR: change.pre_change_mean_r ?? null,
            tradingDays: readiness.trading_days,
            decidedAt: utcMinute(readiness.as_of),
          },
        );
        changeEmails.push({ id: change.id, action, sent, reason });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[gate-automation] ${action} mail failed for ${change.id}:`, message);
        changeEmails.push({ id: change.id, action, sent: false, reason: message });
      }
    }
  }

  return { ran: true, readinessEmailSent, changeEmails, result };
}
