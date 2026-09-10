/**
 * Promotion checkpoint — evidence collection.
 *
 * Reads only what has actually been recorded (spread samples, readiness
 * snapshots, lifecycle rows) and hands it to the pure gate in `promotion.ts`. It
 * writes nothing, promotes nothing and never infers a measurement that is
 * absent: an unreadable input becomes `null`, which the gate treats as a blocker.
 *
 * Sample counting happens INSIDE the database. Reading raw sample rows through
 * the data API silently truncated at its row ceiling, so a fortnight of
 * collection was counted as the newest ~1,000 rows — about three days — and the
 * five-day / 200-sample gate could never be reached however long sampling ran.
 * The aggregate returns one row per instrument, so no ceiling applies, and a
 * failed aggregate read yields no evidence at all rather than an under-count.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { isStage, type InstrumentStage } from "./lifecycle";
import { evaluatePromotion, type PromotionEvidence, type PromotionVerdict } from "./promotion";
import { REGISTRY_SYMBOLS } from "./registry";

/** Sessions the sampler covers across the UTC day. */
export const EXPECTED_SESSIONS = [
  "sydney",
  "tokyo",
  "london",
  "london_new_york_overlap",
  "new_york",
] as const;

/** How far back the evidence window reaches. */
export const EVIDENCE_WINDOW_DAYS = 14;

/** One database-side summary of a single instrument's sample evidence. */
export interface SampleEvidenceRow {
  instrument: string;
  trading_days: number;
  valid_samples: number;
  invalid_samples: number;
  covered_sessions: string[];
  observed_provider_symbols: string[];
  missingness_pct: number | null;
}

export interface PromotionCheckpoint {
  generatedAt: string;
  windowDays: number;
  verdicts: PromotionVerdict[];
  /** Non-fatal read problems, named rather than swallowed. */
  warnings: string[];
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Normalise one aggregate row; anything unreadable stays absent, never zero. */
export function parseSampleEvidence(raw: unknown): SampleEvidenceRow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const instrument = typeof row["instrument"] === "string" ? row["instrument"] : null;
  if (!instrument) return null;
  return {
    instrument,
    trading_days: numberOrNull(row["trading_days"]) ?? 0,
    valid_samples: numberOrNull(row["valid_samples"]) ?? 0,
    invalid_samples: numberOrNull(row["invalid_samples"]) ?? 0,
    covered_sessions: stringList(row["covered_sessions"]),
    observed_provider_symbols: stringList(row["observed_provider_symbols"]),
    missingness_pct: numberOrNull(row["missingness_pct"]),
  };
}

export async function collectPromotionCheckpoint(
  db: SupabaseClient,
  now = new Date(),
): Promise<PromotionCheckpoint> {
  const warnings: string[] = [];
  const since = new Date(now.getTime() - EVIDENCE_WINDOW_DAYS * 86_400_000).toISOString();

  const [samples, stages, snapshots] = await Promise.all([
    db.rpc("get_promotion_sample_evidence", { _since: since }),
    db.from("instrument_lifecycle").select("symbol, stage"),
    db
      .from("instrument_readiness_snapshots")
      .select(
        "instrument, ready, checks, checked_at, conversion_route_ready, conversion_data_ready, provider_symbol, spread_floor_candidate",
      )
      .gte("checked_at", since)
      .order("checked_at", { ascending: false })
      .limit(1_000),
  ]);

  if (samples.error) warnings.push(`spread samples unreadable: ${samples.error.message}`);
  if (stages.error) warnings.push(`lifecycle stages unreadable: ${stages.error.message}`);
  if (snapshots.error) warnings.push(`readiness snapshots unreadable: ${snapshots.error.message}`);

  const stageOf = new Map<string, InstrumentStage | null>();
  for (const row of stages.data ?? []) {
    const stage = (row as { symbol: string; stage: unknown }).stage;
    stageOf.set((row as { symbol: string }).symbol, isStage(stage) ? stage : null);
  }

  const latestSnapshot = new Map<string, Record<string, unknown>>();
  for (const row of (snapshots.data ?? []) as Record<string, unknown>[]) {
    const key = String(row["instrument"]);
    if (!latestSnapshot.has(key)) latestSnapshot.set(key, row);
  }

  const sampleEvidence = new Map<string, SampleEvidenceRow>();
  if (!samples.error) {
    for (const raw of Array.isArray(samples.data) ? samples.data : []) {
      const parsed = parseSampleEvidence(raw);
      if (parsed) sampleEvidence.set(parsed.instrument, parsed);
    }
  }

  const verdicts: PromotionVerdict[] = [];

  for (const instrument of REGISTRY_SYMBOLS) {
    const mine = sampleEvidence.get(instrument) ?? null;
    const snapshot = latestSnapshot.get(instrument) ?? null;
    const failedChecks = Array.isArray(snapshot?.["checks"])
      ? (snapshot["checks"] as { name?: string; ok?: boolean }[])
          .filter((c) => c.ok === false)
          .map((c) => String(c.name ?? "unknown"))
      : [];

    const snapshotFloor = Number(snapshot?.["spread_floor_candidate"]);

    const evidence: PromotionEvidence = {
      instrument,
      stage: stageOf.has(instrument) ? (stageOf.get(instrument) ?? null) : null,
      tradingDays: mine?.trading_days ?? 0,
      validSamples: mine?.valid_samples ?? 0,
      invalidSamples: mine?.invalid_samples ?? 0,
      expectedSessions: [...EXPECTED_SESSIONS],
      coveredSessions: mine?.covered_sessions ?? [],
      // Absent aggregate means unmeasured, which the gate blocks on. It never
      // becomes 0% "clean".
      missingnessPct: mine ? mine.missingness_pct : null,
      readiness: snapshot
        ? {
            ready: snapshot["ready"] === true,
            checkedAt: String(snapshot["checked_at"]),
            conversionRouteReady: snapshot["conversion_route_ready"] === true,
            conversionDataReady: snapshot["conversion_data_ready"] === true,
            providerSymbol: (snapshot["provider_symbol"] as string | null) ?? null,
            failedChecks,
          }
        : null,
      mappedProviderSymbol: (snapshot?.["provider_symbol"] as string | null) ?? null,
      observedProviderSymbols: mine?.observed_provider_symbols ?? [],
      spreadFloorCandidate:
        Number.isFinite(snapshotFloor) && snapshotFloor > 0 ? snapshotFloor : null,
    };

    verdicts.push(evaluatePromotion(evidence, now.getTime()));
  }

  return {
    generatedAt: now.toISOString(),
    windowDays: EVIDENCE_WINDOW_DAYS,
    verdicts,
    warnings,
  };
}
