/**
 * Learning-milestone notifier.
 *
 * Emails the operator exactly once when the shadow telemetry dataset first
 * crosses each activation gate, so it is obvious when the Intelligence Panel
 * stops being purely advisory.
 *
 * Runs at the tail of the hourly shadow-resolve cron and is fully guarded: an
 * email failure must never mark the resolution pass as failed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MIN_N_FILL, MIN_N_WIN } from "./regime";

/** Shape returned by recompute_regime_stats(). */
export interface RegimeStatsSummary {
  resolved_samples?: number;
  filled_samples?: number;
  wins?: number;
  global_p_fill?: number;
  global_p_win?: number;
}

type Gate = "fill" | "win";

export interface MilestoneOutcome {
  gate: Gate;
  sent: boolean;
  reason?: string;
}

/**
 * The fill gate counts resolved samples; the win gate counts samples that
 * actually filled. These mirror regime.ts exactly — a setup that never filled
 * teaches nothing about win rate.
 */
function gatesReached(stats: RegimeStatsSummary): Gate[] {
  const reached: Gate[] = [];
  if ((stats.resolved_samples ?? 0) >= MIN_N_FILL) reached.push("fill");
  if ((stats.filled_samples ?? 0) >= MIN_N_WIN) reached.push("win");
  return reached;
}

export async function notifyLearningMilestones(
  db: SupabaseClient,
  stats: RegimeStatsSummary | null | undefined,
): Promise<MilestoneOutcome[]> {
  if (!stats) return [];

  const results: MilestoneOutcome[] = [];

  for (const gate of gatesReached(stats)) {
    // Claim first, send second. The claim is a conditional UPDATE, so a second
    // overlapping cron run gets false and sends nothing.
    const { data: claimed, error: claimError } = await db.rpc("claim_learning_milestone", {
      _gate: gate,
    });
    if (claimError) {
      console.error(`[learning-milestone] claim failed for ${gate}:`, claimError.message);
      results.push({ gate, sent: false, reason: claimError.message });
      continue;
    }
    if (!claimed) continue; // already notified on an earlier cycle

    try {
      const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
      const result = await sendTemplateEmail("learning-milestone", "", {
        // Stable key per gate: a transport-level retry cannot duplicate the mail.
        idempotencyKey: `learning-milestone-${gate}`,
        templateData: {
          gate,
          threshold: gate === "fill" ? MIN_N_FILL : MIN_N_WIN,
          resolvedSamples: stats.resolved_samples ?? null,
          filledSamples: stats.filled_samples ?? null,
          wins: stats.wins ?? null,
          globalPFill: stats.global_p_fill ?? null,
          globalPWin: stats.global_p_win ?? null,
          reachedAt: new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC",
        },
      });
      results.push({ gate, sent: result.sent, reason: result.sent ? undefined : result.reason });
    } catch (err) {
      // Release the latch so the next hourly cycle retries rather than silently
      // swallowing the only notification for this milestone.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[learning-milestone] send failed for ${gate}, re-arming:`, message);
      await db.rpc("release_learning_milestone", { _gate: gate });
      results.push({ gate, sent: false, reason: message });
    }
  }

  return results;
}
