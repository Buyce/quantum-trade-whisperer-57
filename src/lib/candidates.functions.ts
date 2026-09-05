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
import type { CandidateFunnel, CandidateLineage } from "@/lib/learning/candidates";
import { EMPTY_CANDIDATE_FUNNEL, EMPTY_CANDIDATE_LINEAGE } from "@/lib/learning/candidates";
import {
  summarizeFilterLift,
  type FilterLiftGate,
  type FilterLiftRow,
} from "@/lib/learning/filter-lift";

const OWNER_EMAIL = "boatengampomah@gmail.com";

/** Exported for the sibling learning functions — one owner check, one source. */
export function assertOwner(claims: Record<string, unknown>): void {
  const email = String(claims["email"] ?? "").toLowerCase();
  if (email !== OWNER_EMAIL) throw new Error("Forbidden");
}

export function ownerEmail(claims: Record<string, unknown>): string {
  return String(claims["email"] ?? "").toLowerCase();
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

/**
 * Per-candidate lineage, paged. The SQL function re-checks `is_admin()` and
 * joins only research-cohort shadow rows, so a production row can never leak
 * into a research read.
 */
export const getCandidateLineage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => {
    const raw = (data ?? {}) as { limit?: unknown; offset?: unknown };
    const limit = Math.min(200, Math.max(1, Number(raw.limit ?? 50) || 50));
    const offset = Math.max(0, Number(raw.offset ?? 0) || 0);
    return { limit, offset };
  })
  .handler(async ({ context, data }): Promise<CandidateLineage> => {
    assertOwner(context.claims as Record<string, unknown>);

    const rpc = context.supabase.rpc.bind(context.supabase) as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;

    const { data: rows, error } = await rpc("get_admin_candidate_lineage", {
      _limit: data.limit,
      _offset: data.offset,
    });
    if (error) throw new Error(error.message);
    return (rows as CandidateLineage) ?? EMPTY_CANDIDATE_LINEAGE;
  });

/**
 * Filter lift: how the rejected arm replayed against the published arm, per
 * gate. Measurement only — nothing here changes a live threshold, and a gate
 * without enough matured samples is reported as undecidable rather than as a
 * recommendation.
 */
export const getFilterLift = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ generated_at: string; gates: FilterLiftGate[] }> => {
    assertOwner(context.claims as Record<string, unknown>);

    const rpc = context.supabase.rpc.bind(context.supabase) as unknown as (
      name: string,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;

    const { data, error } = await rpc("get_admin_filter_lift");
    if (error) throw new Error(error.message);

    const payload = (data ?? {}) as {
      generated_at?: string;
      rows?: (FilterLiftRow & { slice_dim?: string })[];
    };
    // Slice rows exist alongside the global ones; mixing them would double-count.
    const global = (payload.rows ?? []).filter((r) => (r.slice_dim ?? "global") === "global");
    return {
      generated_at: payload.generated_at ?? new Date().toISOString(),
      gates: summarizeFilterLift(global),
    };
  });
