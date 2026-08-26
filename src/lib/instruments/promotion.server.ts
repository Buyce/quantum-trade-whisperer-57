/**
 * Promotion checkpoint — evidence collection.
 *
 * Reads only what has actually been recorded (spread samples, spread stats,
 * readiness snapshots, lifecycle rows, mapping authority) and hands it to the
 * pure gate in `promotion.ts`. It writes nothing, promotes nothing and never
 * infers a measurement that is absent: an unreadable input becomes `null`, which
 * the gate treats as a blocker.
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

interface SampleRow {
  instrument: string;
  provider_symbol: string | null;
  quality: string | null;
  session: string | null;
  received_at: string;
  spread_price: number | null;
}

export interface PromotionCheckpoint {
  generatedAt: string;
  windowDays: number;
  verdicts: PromotionVerdict[];
  /** Non-fatal read problems, named rather than swallowed. */
  warnings: string[];
}

export async function collectPromotionCheckpoint(
  db: SupabaseClient,
  now = new Date(),
): Promise<PromotionCheckpoint> {
  const warnings: string[] = [];
  const since = new Date(now.getTime() - EVIDENCE_WINDOW_DAYS * 86_400_000).toISOString();

  const [samples, stages, snapshots, stats] = await Promise.all([
    db
      .from("instrument_spread_samples")
      .select("instrument, provider_symbol, quality, session, received_at, spread_price")
      .gte("received_at", since)
      .order("received_at", { ascending: false })
      .limit(20_000),
    db.from("instrument_lifecycle").select("symbol, stage"),
    db
      .from("instrument_readiness_snapshots")
      .select(
        "instrument, ready, checks, checked_at, conversion_route_ready, conversion_data_ready, provider_symbol, spread_floor_candidate",
      )
      .gte("checked_at", since)
      .order("checked_at", { ascending: false })
      .limit(2_000),
    db
      .from("instrument_spread_stats")
      .select("instrument, missingness, p90_spread_price, calculated_at")
      .order("calculated_at", { ascending: false })
      .limit(2_000),
  ]);

  if (samples.error) warnings.push(`spread samples unreadable: ${samples.error.message}`);
  if (stages.error) warnings.push(`lifecycle stages unreadable: ${stages.error.message}`);
  if (snapshots.error) warnings.push(`readiness snapshots unreadable: ${snapshots.error.message}`);
  if (stats.error) warnings.push(`spread statistics unreadable: ${stats.error.message}`);

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

  const latestMissingness = new Map<string, number | null>();
  for (const row of (stats.data ?? []) as Record<string, unknown>[]) {
    const key = String(row["instrument"]);
    if (latestMissingness.has(key)) continue;
    const value = Number(row["missingness"]);
    latestMissingness.set(key, Number.isFinite(value) ? value : null);
  }

  const rows = (samples.data ?? []) as SampleRow[];
  const verdicts: PromotionVerdict[] = [];

  for (const instrument of REGISTRY_SYMBOLS) {
    const mine = rows.filter((r) => r.instrument === instrument);
    const valid = mine.filter((r) => r.quality === "valid");
    const days = new Set(valid.map((r) => r.received_at.slice(0, 10)));
    const sessions = new Set(valid.map((r) => r.session).filter((s): s is string => !!s));
    const providerSymbols = new Set(
      mine.map((r) => r.provider_symbol).filter((s): s is string => !!s),
    );

    const snapshot = latestSnapshot.get(instrument) ?? null;
    const failedChecks = Array.isArray(snapshot?.["checks"])
      ? (snapshot["checks"] as { name?: string; ok?: boolean }[])
          .filter((c) => c.ok === false)
          .map((c) => String(c.name ?? "unknown"))
      : [];

    const snapshotFloor = Number(snapshot?.["spread_floor_candidate"]);
    const missingnessFromStats = latestMissingness.get(instrument) ?? null;
    // Prefer the aggregate; fall back to the raw ratio this window actually shows.
    const missingnessPct =
      missingnessFromStats !== null
        ? missingnessFromStats
        : mine.length > 0
          ? ((mine.length - valid.length) / mine.length) * 100
          : null;

    const evidence: PromotionEvidence = {
      instrument,
      stage: stageOf.has(instrument) ? (stageOf.get(instrument) ?? null) : null,
      tradingDays: days.size,
      validSamples: valid.length,
      invalidSamples: mine.length - valid.length,
      expectedSessions: [...EXPECTED_SESSIONS],
      coveredSessions: [...sessions],
      missingnessPct,
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
      observedProviderSymbols: [...providerSymbols],
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
