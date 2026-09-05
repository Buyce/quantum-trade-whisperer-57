/**
 * Exit-variant research pass (read + record).
 *
 * Reads matured Replay V2 research rows that carry a recorded post-fill path,
 * simulates every exit variant against the SAME path, and records each variant's
 * mean R beside the current single-exit baseline — plus a chronological
 * out-of-sample check reusing the existing walk-forward evaluator.
 *
 * Nothing here changes live execution. The live policy stays
 * `single_exit_first_target` until a variant beats it out of sample AND a
 * separate, deliberate promotion is made.
 *
 * Zero-hallucination rules:
 *  - Only setups whose path decides BOTH the baseline and the variant enter that
 *    variant's comparison, so the delta is paired and never mixes populations.
 *  - Undecidable setups are counted and reported, never resolved either way.
 *  - A thin or unreadable population records "not confirmed" with the blocker
 *    named. Failing to measure can never authorise a change.
 *
 * Runs inside the existing hourly shadow-resolve pass. No new schedule, no
 * second copy of the data.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { EXECUTION_POLICY_V2, REPLAY_V2_VERSION } from "@/lib/execution/replay-registry";
import {
  BASELINE_VARIANT,
  EXIT_VARIANTS,
  parseExitPath,
  simulateVariant,
  type ExitVariant,
} from "@/lib/execution/exit-variants";
import { evaluateWalkForward, type WalkForwardObservation } from "@/lib/stats/walk-forward";

/** Maturity horizon, matching the other research passes. */
export const MATURITY_HOURS = 24;
/** Bound on rows read per pass. */
const ROW_LIMIT = 2000;
/** Minimum paired, decidable setups before a variant reports a mean at all. */
export const MIN_VARIANT_SAMPLES = 30;
/** Minimum independent instrument-day clusters before a mean is reported. */
export const MIN_VARIANT_CLUSTERS = 5;

interface PathRow {
  detected_at: string;
  instrument: string;
  post_entry_path: unknown;
}

export interface VariantSummary {
  variant: ExitVariant;
  samples: number;
  undecidable: number;
  clusters: number;
  meanR: number | null;
  baselineMeanR: number | null;
  deltaR: number | null;
  holdoutConfirmed: boolean;
  holdoutDeltaR: number | null;
  holdoutLow: number | null;
  holdoutHigh: number | null;
  splitDay: string | null;
  trainDays: number;
  holdoutDays: number;
  blockers: string[];
  detail: string;
}

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(4));

/** Pure: turn read rows into one summary per variant. */
export function summariseVariants(rows: PathRow[], nowMs: number): VariantSummary[] {
  interface Paired {
    day: string;
    cluster: string;
    baseline: number;
    variant: number;
  }
  const paired: Record<string, Paired[]> = {};
  const undecided: Record<string, number> = {};
  for (const variant of EXIT_VARIANTS) {
    paired[variant] = [];
    undecided[variant] = 0;
  }

  for (const row of rows) {
    const detected = Date.parse(row.detected_at);
    if (!Number.isFinite(detected)) continue;
    if (detected + MATURITY_HOURS * 3_600_000 > nowMs) continue; // not matured yet
    const path = parseExitPath(row.post_entry_path);
    if (!path) continue;

    const base = simulateVariant(BASELINE_VARIANT, path);
    const day = new Date(detected).toISOString().slice(0, 10);
    const cluster = `${day}|${row.instrument}`;

    for (const variant of EXIT_VARIANTS) {
      const outcome = variant === BASELINE_VARIANT ? base : simulateVariant(variant, path);
      // Paired by construction: a setup counts only when the same path decides
      // both the baseline and the variant.
      if (!base.decidable || !outcome.decidable || base.r === null || outcome.r === null) {
        undecided[variant] = (undecided[variant] ?? 0) + 1;
        continue;
      }
      paired[variant]?.push({ day, cluster, baseline: base.r, variant: outcome.r });
    }
  }

  return EXIT_VARIANTS.map((variant) => {
    const rowsForVariant = paired[variant] ?? [];
    const clusters = new Set(rowsForVariant.map((r) => r.cluster)).size;
    const blockers: string[] = [];
    if (rowsForVariant.length < MIN_VARIANT_SAMPLES) {
      blockers.push(
        `Needs ${MIN_VARIANT_SAMPLES} decidable replayed setups; has ${rowsForVariant.length}.`,
      );
    }
    if (clusters < MIN_VARIANT_CLUSTERS) {
      blockers.push(`Needs ${MIN_VARIANT_CLUSTERS} independent instrument-days; has ${clusters}.`);
    }

    const enough = blockers.length === 0;
    const variantMean = enough ? mean(rowsForVariant.map((r) => r.variant)) : null;
    const baselineMean = enough ? mean(rowsForVariant.map((r) => r.baseline)) : null;
    const deltaR =
      variantMean === null || baselineMean === null
        ? null
        : Number((variantMean - baselineMean).toFixed(4));

    // Out-of-sample check: the paired difference is expressed as the existing
    // evaluator's fail-minus-pass delta, so one validated implementation serves
    // both gates and exits.
    const observations: WalkForwardObservation[] = rowsForVariant.flatMap((r) => [
      { day: r.day, cluster: r.cluster, arm: "pass" as const, r: r.baseline },
      { day: r.day, cluster: r.cluster, arm: "fail" as const, r: r.variant },
    ]);
    const wf = enough
      ? evaluateWalkForward(observations)
      : {
          confirmed: false,
          splitDay: null,
          train: null,
          holdout: null,
          blockers,
          detail: "Not enough decidable replayed setups to split by time.",
        };

    const detail =
      variant === BASELINE_VARIANT
        ? "Current live policy — the baseline every variant is compared against."
        : enough
          ? wf.detail
          : "Not measured yet: the replayed path record is still too thin.";

    return {
      variant,
      samples: rowsForVariant.length,
      undecidable: undecided[variant] ?? 0,
      clusters,
      meanR: variantMean,
      baselineMeanR: baselineMean,
      deltaR,
      holdoutConfirmed: variant === BASELINE_VARIANT ? false : wf.confirmed,
      holdoutDeltaR: wf.holdout?.deltaR ?? null,
      holdoutLow: wf.holdout?.low ?? null,
      holdoutHigh: wf.holdout?.high ?? null,
      splitDay: wf.splitDay,
      trainDays: wf.train?.days ?? 0,
      holdoutDays: wf.holdout?.days ?? 0,
      blockers: enough ? wf.blockers : blockers,
      detail,
    };
  });
}

export interface ExitVariantPassResult {
  ran: boolean;
  error?: string | undefined;
  variants?: VariantSummary[] | undefined;
}

export async function runExitVariantPass(
  db: SupabaseClient,
  now: number = Date.now(),
): Promise<ExitVariantPassResult> {
  let rows: PathRow[];
  try {
    const { data, error } = await db
      .from("shadow_executions")
      .select("detected_at, instrument, post_entry_path")
      .eq("replay_version", REPLAY_V2_VERSION)
      .eq("execution_policy", EXECUTION_POLICY_V2)
      .eq("status", "resolved")
      .not("post_entry_path", "is", null)
      .order("detected_at", { ascending: true })
      .limit(ROW_LIMIT);
    if (error) throw new Error(error.message);
    rows = (data ?? []) as unknown as PathRow[];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[exit-variants] read failed:", message);
    return { ran: false, error: message };
  }

  const variants = summariseVariants(rows, now);
  const records = variants.map((v) => ({
    variant: v.variant,
    replay_version: REPLAY_V2_VERSION,
    execution_policy: EXECUTION_POLICY_V2,
    samples: v.samples,
    undecidable: v.undecidable,
    clusters: v.clusters,
    mean_r: v.meanR,
    baseline_mean_r: v.baselineMeanR,
    delta_r: v.deltaR,
    holdout_confirmed: v.holdoutConfirmed,
    holdout_delta_r: v.holdoutDeltaR,
    holdout_low: v.holdoutLow,
    holdout_high: v.holdoutHigh,
    split_day: v.splitDay,
    train_days: v.trainDays,
    holdout_days: v.holdoutDays,
    blockers: v.blockers,
    detail: v.detail,
    computed_at: new Date(now).toISOString(),
  }));

  const { error } = await db
    .from("exit_variant_results")
    .upsert(records as never, { onConflict: "variant" });
  if (error) {
    console.error("[exit-variants] write failed:", error.message);
    return { ran: false, error: error.message, variants };
  }

  return { ran: true, variants };
}
