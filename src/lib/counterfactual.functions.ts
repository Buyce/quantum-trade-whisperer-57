/**
 * Owner-only counterfactual stop measurement (research read).
 *
 * Runs `src/lib/learning/counterfactual.ts` over resolved Replay V2 rows and
 * returns the honest distribution for a sweep of tighter-stop factors. This is a
 * pure READ: it changes no setting, no sizing, no live behaviour.
 *
 * ZERO-HALLUCINATION: rows come from `shadow_executions` only, and only rows
 * that actually carry a realized R and a measured adverse excursion take part.
 * Rows that cannot be adjudicated are reported as excluded or ambiguous, never
 * resolved in our favour. An empty dataset returns empty arms, not zeros
 * dressed up as evidence.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  evaluateBreakevenStop,
  evaluateTighterStop,
  isSupported,
  type CounterfactualInput,
  type CounterfactualReport,
  type NotDecidable,
} from "@/lib/learning/counterfactual";

const OWNER_EMAIL = "boatengampomah@gmail.com";

/** The sweep the panel reports. Wider than 0.8 is not worth measuring. */
export const STOP_FACTOR_SWEEP = [0.4, 0.5, 0.6, 0.7, 0.8] as const;

/** Cap the read so an owner page can never pull an unbounded table. */
const ROW_LIMIT = 5000;

export interface StopFactorResult {
  factor: number;
  supported: boolean;
  considered: number;
  deterministic: number;
  ambiguous: number;
  excluded: number;
  baselineMeanR: number | null;
  conservativeMeanR: number | null;
  conservativeCiLo: number | null;
  conservativeCiHi: number | null;
  optimisticMeanR: number | null;
  provenOnlyMeanR: number | null;
  clusterN: number;
  bootstrapStatus: string;
}

export interface CounterfactualSummary {
  as_of: string;
  /** Rows read from `shadow_executions` before adjudication. */
  rows_read: number;
  factors: StopFactorResult[];
  /** Rules the stored path summary cannot decide, with the reason. */
  not_decidable: NotDecidable[];
}

const project = (report: CounterfactualReport): StopFactorResult => ({
  factor: report.factor,
  supported: isSupported(report),
  considered: report.considered,
  deterministic: report.deterministic,
  ambiguous: report.ambiguous,
  excluded: report.excluded,
  baselineMeanR: report.baseline.meanR,
  conservativeMeanR: report.conservative.meanR,
  conservativeCiLo: report.conservative.bootstrap.ciLo,
  conservativeCiHi: report.conservative.bootstrap.ciHi,
  optimisticMeanR: report.optimistic.meanR,
  provenOnlyMeanR: report.provenOnly.meanR,
  clusterN: report.conservative.bootstrap.clusterN,
  bootstrapStatus: report.conservative.bootstrap.status,
});

export const getCounterfactualStops = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CounterfactualSummary> => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    const { data, error } = await context.supabase
      .from("shadow_executions")
      .select("id, detected_at, resolved_outcome, gross_r, realized_r, max_adverse_excursion_r, max_favorable_excursion_r")
      .not("resolved_outcome", "is", null)
      .order("detected_at", { ascending: true })
      .limit(ROW_LIMIT);
    if (error) throw new Error(error.message);

    const rows: CounterfactualInput[] = (data ?? []).map((r) => ({
      id: String(r.id),
      detectedAt: String(r.detected_at),
      outcome: r.resolved_outcome,
      // Replay V2 writes gross_r; legacy V1 rows carry realized_r only.
      grossR: r.gross_r ?? r.realized_r,
      maeR: r.max_adverse_excursion_r,
      mfeR: r.max_favorable_excursion_r,
    }));

    const factors: StopFactorResult[] = [];
    const notDecidable: NotDecidable[] = [];
    for (const factor of STOP_FACTOR_SWEEP) {
      const report = evaluateTighterStop(rows, factor);
      if ("decidable" in report) notDecidable.push(report);
      else factors.push(project(report));
    }
    // The break-even rule is structurally undecidable from the stored summary.
    notDecidable.push(evaluateBreakevenStop(0.7));

    return {
      as_of: new Date().toISOString(),
      rows_read: rows.length,
      factors,
      not_decidable: notDecidable,
    };
  });
