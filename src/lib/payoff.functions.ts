/**
 * Owner-only payoff research reads.
 *
 * Defence in depth: each handler rejects a non-owner identity before touching
 * the database, and the SQL functions independently re-check `is_admin()`. The
 * payoff tables themselves grant nothing to `anon` or `authenticated`, so there
 * is no direct read path at all.
 *
 * ZERO-HALLUCINATION: every figure is an aggregate over resolved replay rows.
 * An empty or immature cohort returns empty and the UI says why.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PayoffResearch } from "@/lib/learning/payoff";

const OWNER_EMAIL = "boatengampomah@gmail.com";

function assertOwner(claims: Record<string, unknown>): void {
  const email = String(claims['email'] ?? "").toLowerCase();
  if (email !== OWNER_EMAIL) throw new Error("Forbidden");
}

export const getPayoffResearch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PayoffResearch> => {
    assertOwner(context.claims as Record<string, unknown>);

    const rpc = context.supabase.rpc.bind(context.supabase) as unknown as (
      name: string,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;

    const { data, error } = await rpc("get_admin_payoff_research");
    if (error) throw new Error(error.message);
    return (data as PayoffResearch) ?? { generated_at: new Date().toISOString(), cohorts: [], registry: [] };
  });

/**
 * Rebuilds the payoff cohorts at a single frozen instant. Owner-triggered and
 * idempotent: it is safe to run repeatedly and never mutates production
 * `regime_stats`, priors, or any published signal.
 */
export const recomputePayoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ runs: unknown[] }> => {
    assertOwner(context.claims as Record<string, unknown>);

    // The recompute is service_role-only by design; load the privileged client
    // lazily so it never enters the browser graph.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rpc = supabaseAdmin.rpc.bind(supabaseAdmin) as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;

    // Production tuple first, then the research replay identity. Each call takes
    // its own advisory lock and stamps its own as_of.
    const cohorts = [
      { _model_version: 1, _replay_version: 1, _execution_policy: "legacy_best_target_touched" },
      { _model_version: 1, _replay_version: 2, _execution_policy: "single_exit_first_target" },
    ];

    const runs: unknown[] = [];
    for (const args of cohorts) {
      const { data, error } = await rpc("recompute_payoff_stats", { ...args, _horizon_hours: 24 });
      if (error) throw new Error(error.message);
      runs.push(data);
    }
    return { runs };
  });
