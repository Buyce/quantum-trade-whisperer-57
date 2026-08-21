/**
 * Admin-only read of the V1 vs V2 research ledger.
 *
 * `model_observations` has no `authenticated` grant and no policy, so this read
 * is gated on the verified bearer claims and executed with the privileged
 * client — the same shape as the baseline surface.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const OWNER_EMAIL = "boatengampomah@gmail.com";

export interface ModelCohort {
  modelVersion: number;
  observations: number;
  candidates: number;
  noTrade: number;
  errors: number;
  published: number;
  observationOnly: number;
  suppressedCooldown: number;
  byGrade: Record<string, number>;
  byFamily: Record<string, number>;
  p95LatencyMs: number | null;
}

export interface ResearchLedger {
  windowHours: number;
  generatedAt: string;
  cohorts: ModelCohort[];
  /** Observations where V1 and V2 disagreed on whether to trade at all. */
  disagreements: number;
  agreements: number;
  /** Same pairing, V1 against the V3 geometry cohort. */
  disagreementsV3: number;
  agreementsV3: number;
}

const WINDOW_HOURS = 168;

export const getResearchLedger = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ResearchLedger> => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    const { adminClient } = await import("@/lib/scanner/pipeline.server");
    const admin = adminClient();
    const since = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();

    const { data, error } = await admin
      .from("model_observations")
      .select("model_version, observation_key, decision, disposition, grade, family, latency_ms")
      .gte("observed_at", since)
      .order("observed_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const versions = [...new Set(rows.map((r) => Number(r.model_version)))].sort();

    const cohorts: ModelCohort[] = versions.map((v) => {
      const cohort = rows.filter((r) => Number(r.model_version) === v);
      const latencies = cohort
        .map((r) => Number(r.latency_ms))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);
      const byGrade: Record<string, number> = {};
      const byFamily: Record<string, number> = {};
      for (const r of cohort) {
        if (r.grade) byGrade[r.grade] = (byGrade[r.grade] ?? 0) + 1;
        if (r.family) byFamily[r.family] = (byFamily[r.family] ?? 0) + 1;
      }
      const count = (fn: (r: (typeof cohort)[number]) => boolean) => cohort.filter(fn).length;
      return {
        modelVersion: v,
        observations: cohort.length,
        candidates: count((r) => r.decision === "candidate"),
        noTrade: count((r) => r.decision === "no_trade"),
        errors: count((r) => r.decision === "error"),
        published: count((r) => r.disposition === "published"),
        observationOnly: count((r) => r.disposition === "observation_only"),
        suppressedCooldown: count((r) => r.disposition === "suppressed_cooldown"),
        byGrade,
        byFamily,
        p95LatencyMs: latencies.length
          ? (latencies[
              Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))
            ] as number)
          : null,
      };
    });

    // Paired comparison on the shared observation key: same candles, every model.
    const pairs = new Map<string, { v1?: string; v2?: string; v3?: string }>();
    for (const r of rows) {
      if (!r.observation_key) continue;
      const entry = pairs.get(r.observation_key) ?? {};
      if (Number(r.model_version) === 1) entry.v1 = r.decision;
      if (Number(r.model_version) === 2) entry.v2 = r.decision;
      if (Number(r.model_version) === 3) entry.v3 = r.decision;
      pairs.set(r.observation_key, entry);
    }
    let agreements = 0;
    let disagreements = 0;
    let agreementsV3 = 0;
    let disagreementsV3 = 0;
    for (const { v1, v2, v3 } of pairs.values()) {
      if (v1 && v2) {
        if (v1 === v2) agreements += 1;
        else disagreements += 1;
      }
      if (v1 && v3) {
        if (v1 === v3) agreementsV3 += 1;
        else disagreementsV3 += 1;
      }
    }

    return {
      windowHours: WINDOW_HOURS,
      generatedAt: new Date().toISOString(),
      cohorts,
      agreements,
      disagreements,
      agreementsV3,
      disagreementsV3,
    };
  });
