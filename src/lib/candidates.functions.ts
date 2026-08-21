/**
 * Owner-only research candidate funnel read.
 *
 * Defence in depth: the handler rejects a non-owner identity before touching the
 * database and `get_admin_candidate_funnel()` independently re-checks
 * `is_admin()`. `research_candidates` grants nothing to `anon` or
 * `authenticated`, so aggregates are the only read path that exists.
 *
 * ZERO-HALLUCINATION: every number is a count over rows the scanner actually
 * captured. Capture disabled means zeroes, and the panel says so.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CandidateFunnel } from "@/lib/learning/candidates";
import { EMPTY_CANDIDATE_FUNNEL } from "@/lib/learning/candidates";

const OWNER_EMAIL = "boatengampomah@gmail.com";

function assertOwner(claims: Record<string, unknown>): void {
  const email = String(claims["email"] ?? "").toLowerCase();
  if (email !== OWNER_EMAIL) throw new Error("Forbidden");
}

export const getCandidateFunnel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CandidateFunnel> => {
    assertOwner(context.claims as Record<string, unknown>);

    const rpc = context.supabase.rpc.bind(context.supabase) as unknown as (
      name: string,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;

    const { data, error } = await rpc("get_admin_candidate_funnel");
    if (error) throw new Error(error.message);
    return (data as CandidateFunnel) ?? EMPTY_CANDIDATE_FUNNEL;
  });
