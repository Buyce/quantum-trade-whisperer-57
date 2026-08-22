/**
 * Server-side sizing resolver (Prompt 12).
 *
 * Runs both sizing models, returns model 1 as authoritative unless model 2 has
 * been explicitly promoted, and records divergences for review. Advice shown to
 * users therefore cannot change silently on deploy.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateRisk, type RiskProfile, type RiskInput, type RiskResult } from "@/lib/risk";
import { isSpecStale, type SizingSpec } from "./specs";
import { compareSizing, type SizingDivergence } from "./sizing-compare";

type Db = Pick<SupabaseClient, "from">;

export interface ResolvedSizing {
  authoritative: RiskResult;
  /** The model-2 (broker spec) run; equal to `authoritative` once promoted. */
  shadow: RiskResult;
  authoritativeModel: 1 | 2;
  divergence: SizingDivergence;
}

export interface ResolveSizingOptions {
  spec?: SizingSpec | null;
  /** True only when the operator has promoted broker-spec sizing. */
  v2Promoted?: boolean;
  quoteStale?: boolean;
  now?: number;
}

export function resolveSizing(
  input: RiskInput,
  profile: RiskProfile,
  rates: Record<string, number>,
  options: ResolveSizingOptions = {},
): ResolvedSizing {
  const now = options.now ?? Date.now();
  const spec = options.spec ?? null;
  const specStale = spec ? isSpecStale(spec, now) : false;

  const quoteStale = options.quoteStale === true;
  const v1 = calculateRisk(input, profile, rates, { quoteStale });
  const v2 = spec
    ? calculateRisk(input, profile, rates, {
        spec,
        specStale,
        quoteStale,
      })
    : v1;

  const promoted = options.v2Promoted === true && spec !== null && !specStale;

  return {
    authoritative: promoted ? v2 : v1,
    shadow: v2,
    authoritativeModel: promoted ? 2 : 1,
    divergence: compareSizing(v1, v2),
  };
}

/**
 * Best-effort divergence record. Never throws and never blocks the caller's
 * response — an unrecorded divergence must not deny a user their sizing.
 */
export async function logSizingDivergence(
  db: Db,
  row: {
    instrument: string;
    signalId?: string | null;
    userId?: string | null;
    divergence: SizingDivergence;
    authoritativeModel: 1 | 2;
    specSource: "broker" | "static_v1";
  },
): Promise<void> {
  if (!row.divergence.diverged) return;
  try {
    await db.from("sizing_divergence_log").insert({
      instrument: row.instrument,
      signal_id: row.signalId ?? null,
      user_id: row.userId ?? null,
      authoritative_model: row.authoritativeModel,
      spec_source: row.specSource,
      v1_lots: row.divergence.v1Lots,
      v2_lots: row.divergence.v2Lots,
      v1_reason: row.divergence.v1Reason,
      v2_reason: row.divergence.v2Reason,
      lots_delta: row.divergence.lotsDelta,
      risk_delta: row.divergence.riskDelta,
      summary: row.divergence.summary,
    });
  } catch (err) {
    console.error("[sizing] divergence log failed", err);
  }
}
