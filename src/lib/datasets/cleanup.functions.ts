/**
 * Owner-gated, read-only health of the retention clean-up jobs.
 *
 * Retention removes setups from the interactive feed after a grade-tiered
 * window, but only after a full copy lands in `signal_retention_archive`. A
 * silent failure in that job (it failed hourly for weeks because the archive
 * table did not exist) is exactly what this surface exists to make visible.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const OWNER_EMAIL = "boatengampomah@gmail.com";

export interface CleanupJobHealth {
  job: string;
  schedule: string;
  active: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastMessage: string | null;
}

export interface CleanupHealth {
  archivedSignals: number;
  archivedLastAt: string | null;
  liveSignals: number;
  jobs: CleanupJobHealth[];
}

function ownerOnly(claims: Record<string, unknown>) {
  const email = String(claims["email"] ?? "").toLowerCase();
  if (email !== OWNER_EMAIL) throw new Error("Forbidden");
}

export const getCleanupHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CleanupHealth> => {
    ownerOnly(context.claims);
    // Read as the signed-in owner; the SECURITY DEFINER RPC re-applies the gate.
    const { data, error } = await context.supabase.rpc("get_admin_cleanup_health");
    if (error) throw new Error(error.message);

    const payload = (data ?? {}) as {
      archived_signals?: number;
      archived_last_at?: string | null;
      live_signals?: number;
      jobs?: Array<{
        job?: string;
        schedule?: string;
        active?: boolean;
        last_run_at?: string | null;
        last_status?: string | null;
        last_message?: string | null;
      }>;
    };

    return {
      archivedSignals: Number(payload.archived_signals ?? 0),
      archivedLastAt: payload.archived_last_at ?? null,
      liveSignals: Number(payload.live_signals ?? 0),
      jobs: (payload.jobs ?? []).map((j) => ({
        job: String(j.job ?? ""),
        schedule: String(j.schedule ?? ""),
        active: Boolean(j.active),
        lastRunAt: j.last_run_at ?? null,
        lastStatus: j.last_status ?? null,
        lastMessage: j.last_message ? String(j.last_message) : null,
      })),
    };
  });
