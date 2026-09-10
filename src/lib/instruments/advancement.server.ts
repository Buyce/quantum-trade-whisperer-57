/**
 * Automatic stage advancement — evidence collection and execution.
 *
 * Reads recorded facts, hands them to the pure gate in `advancement.ts`, and
 * applies the verdict through the SAME audited transition RPC a human operator
 * uses (`transition_instrument_stage`), with `auto-advance` as the approver and
 * the evidence attached to the history row. Nothing here writes a stage directly.
 *
 * The kill switch (`execution_controls.auto_stage_advance_enabled`) FAILS CLOSED:
 * if the switch cannot be read, no instrument moves.
 *
 * Outcome evidence comes from the replay ledger (`shadow_executions`), which is
 * the only per-instrument resolved-R record that exists for instruments that are
 * not executing yet. The `production` cohort is the strategy's own plans; rows
 * detected after the instrument reached `signals_only` are additionally the
 * post-publication set. No number is synthesised: an unreadable read stays null
 * and the gate blocks on it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { clusterBootstrapMeanR, type RObservation } from "../stats/bootstrap";
import { utcDayKey } from "../stats/clusters";
import {
  evaluateAdvancement,
  utcDay,
  type AdvancementEvidence,
  type AdvancementVerdict,
  type HoldoutEvidence,
  type OutcomeEvidence,
  type ReadinessRecency,
  READINESS_RECENT_SNAPSHOTS,
} from "./advancement";
import { isStage, type InstrumentStage } from "./lifecycle";
import { transitionStage } from "./lifecycle.server";
import { collectPromotionCheckpoint } from "./promotion.server";
import { REGISTRY_SYMBOLS } from "./registry";

/** Approver recorded on every automatic transition. */
export const AUTO_APPROVER = "auto-advance";

/** How far back outcome and readiness evidence reaches. */
export const ADVANCEMENT_WINDOW_DAYS = 30;

/** Fraction of days used as the chronological training period. */
const TRAIN_FRACTION = 0.7;

export interface AdvancementRun {
  ranAt: string;
  enabled: boolean;
  verdicts: AdvancementVerdict[];
  applied: Array<{
    instrument: string;
    from: InstrumentStage | null;
    to: InstrumentStage;
    action: "promote";
    ok: boolean;
    error?: string;
  }>;
  warnings: string[];
}

/** FAIL CLOSED: unreadable switch means no advancement. */
export async function readAutoAdvanceEnabled(db: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await db
      .from("execution_controls")
      .select("auto_stage_advance_enabled")
      .eq("id", true)
      .maybeSingle();
    if (error || !data) return false;
    return (data as { auto_stage_advance_enabled?: boolean }).auto_stage_advance_enabled === true;
  } catch {
    return false;
  }
}

function outcomeEvidence(rows: RObservation[]): OutcomeEvidence {
  const result = clusterBootstrapMeanR(rows);
  return {
    samples: result.n,
    clusters: result.clusterN,
    expectedR: result.mean,
    ciLow: result.ciLo,
    ciHigh: result.ciHi,
  };
}

/**
 * Chronological split on WHOLE UTC DAYS: the earlier 70% of observed days train,
 * the later 30% are the holdout. Splitting on rows instead of days would let one
 * busy day straddle both periods.
 */
export function chronologicalHoldout(rows: RObservation[]): HoldoutEvidence | null {
  const days = [...new Set(rows.map((r) => utcDayKey(r.detectedAt)))].sort();
  if (days.length < 4) return null;
  const cut = Math.floor(days.length * TRAIN_FRACTION);
  const holdoutDays = new Set(days.slice(cut));
  const splitDay = days[cut] ?? null;
  if (!splitDay || holdoutDays.size === 0) return null;

  const holdoutRows = rows.filter((r) => holdoutDays.has(utcDayKey(r.detectedAt)));
  // A sub-period cannot carry as many whole days as full history, so the interval
  // is computed at the chronological-period cluster floor.
  const result = clusterBootstrapMeanR(holdoutRows, { minClusters: 5 });
  return {
    splitDay,
    samples: result.n,
    clusters: result.clusterN,
    meanR: result.mean,
    ciLow: result.ciLo,
  };
}

/** Realised research R for one replay row, or null when it is not usable. */
function replayR(row: Record<string, unknown>): number | null {
  for (const key of ["net_r", "realized_r"]) {
    const value = Number(row[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export async function collectAdvancementEvidence(
  db: SupabaseClient,
  now = new Date(),
): Promise<{ evidence: AdvancementEvidence[]; warnings: string[] }> {
  const warnings: string[] = [];
  const since = new Date(now.getTime() - ADVANCEMENT_WINDOW_DAYS * 86_400_000).toISOString();

  const [checkpoint, stages, replay, readiness, transitions] = await Promise.all([
    collectPromotionCheckpoint(db, now),
    db.from("instrument_lifecycle").select("symbol, stage"),
    db
      .from("shadow_executions")
      .select("id, instrument, detected_at, net_r, realized_r, resolved_outcome, cohort")
      .eq("cohort", "production")
      .not("resolved_outcome", "is", null)
      .gte("detected_at", since)
      .order("detected_at", { ascending: false })
      .limit(5_000),
    db
      .from("instrument_readiness_snapshots")
      .select("instrument, ready, checked_at")
      .gte("checked_at", since)
      .limit(5_000),
    db
      .from("instrument_lifecycle_transitions")
      .select("symbol, to_stage, approver, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(2_000),
  ]);

  if (stages.error) warnings.push(`lifecycle stages unreadable: ${stages.error.message}`);
  if (replay.error) warnings.push(`replay outcomes unreadable: ${replay.error.message}`);
  if (readiness.error) warnings.push(`readiness history unreadable: ${readiness.error.message}`);
  if (transitions.error)
    warnings.push(`transition history unreadable: ${transitions.error.message}`);
  warnings.push(...checkpoint.warnings);

  const stageOf = new Map<string, InstrumentStage | null>();
  for (const row of (stages.data ?? []) as { symbol: string; stage: unknown }[]) {
    stageOf.set(row.symbol, isStage(row.stage) ? row.stage : null);
  }

  const rowsByInstrument = new Map<string, RObservation[]>();
  for (const raw of (replay.data ?? []) as Record<string, unknown>[]) {
    const instrument = typeof raw["instrument"] === "string" ? raw["instrument"] : null;
    const detectedAt = typeof raw["detected_at"] === "string" ? raw["detected_at"] : null;
    const r = replayR(raw);
    if (!instrument || !detectedAt || r === null) continue;
    const list = rowsByInstrument.get(instrument) ?? [];
    list.push({ id: String(raw["id"]), detectedAt, r });
    rowsByInstrument.set(instrument, list);
  }

  // CURRENT readiness standing: newest snapshots only, newest first. A failure that
  // has since been repaired must not hold an instrument back for the whole window.
  const readinessOf = new Map<string, ReadinessRecency>();
  if (!readiness.error) {
    const byInstrument = new Map<string, { ready: boolean; checked_at: string }[]>();
    for (const row of (readiness.data ?? []) as {
      instrument: string;
      ready: boolean;
      checked_at: string;
    }[]) {
      const list = byInstrument.get(row.instrument) ?? [];
      list.push(row);
      byInstrument.set(row.instrument, list);
    }
    for (const [instrument, rows] of byInstrument) {
      const newest = [...rows]
        .sort((a, b) => (a.checked_at < b.checked_at ? 1 : -1))
        .slice(0, READINESS_RECENT_SNAPSHOTS);
      const latest = newest[0];
      readinessOf.set(instrument, {
        latestReady: latest ? latest.ready === true : null,
        latestCheckedAt: latest?.checked_at ?? null,
        recentFailures: newest.filter((r) => r.ready === false).length,
        considered: newest.length,
      });
    }
  }


  const lastAutoDay = new Map<string, string>();
  const publishedSince = new Map<string, string>();
  if (!transitions.error) {
    for (const row of (transitions.data ?? []) as {
      symbol: string;
      to_stage: string;
      approver: string;
      created_at: string;
    }[]) {
      if (row.approver === AUTO_APPROVER && !lastAutoDay.has(row.symbol)) {
        lastAutoDay.set(row.symbol, utcDayKey(row.created_at));
      }
      if (row.to_stage === "signals_only" && !publishedSince.has(row.symbol)) {
        publishedSince.set(row.symbol, row.created_at);
      }
    }
  }

  const verdictOf = new Map(checkpoint.verdicts.map((v) => [v.instrument, v]));

  const evidence: AdvancementEvidence[] = REGISTRY_SYMBOLS.map((instrument) => {
    const rows = rowsByInstrument.get(instrument) ?? [];
    const promotion = verdictOf.get(instrument) ?? null;
    const publishedFrom = publishedSince.get(instrument) ?? null;
    const publishedRows = publishedFrom ? rows.filter((r) => r.detectedAt >= publishedFrom) : [];

    return {
      instrument,
      stage: stageOf.has(instrument) ? (stageOf.get(instrument) ?? null) : null,
      promotion,
      // No replay rows at all is genuinely "nothing measured yet"; the zero-count
      // evidence below blocks on sample count rather than pretending success.
      shadow: replay.error ? null : outcomeEvidence(rows),
      published: replay.error ? null : outcomeEvidence(publishedRows),
      holdout: replay.error ? null : chronologicalHoldout(rows),
      readinessFailures: readiness.error ? null : (readinessFailures.get(instrument) ?? 0),
      missingnessPct: promotion ? promotion.evidence.missingnessPct : null,
      lastAutoTransitionDay: lastAutoDay.get(instrument) ?? null,
    };
  });

  return { evidence, warnings };
}

/**
 * One advancement pass. Evaluates every registry instrument and applies at most
 * one transition each, through the audited RPC with a compare-and-set on the
 * stage the evidence was read at.
 */
export async function runAdvancement(
  db: SupabaseClient,
  now = new Date(),
): Promise<AdvancementRun> {
  const enabled = await readAutoAdvanceEnabled(db);
  if (!enabled) {
    return {
      ranAt: now.toISOString(),
      enabled: false,
      verdicts: [],
      applied: [],
      warnings: ["Automatic stage advancement is switched off or unreadable; nothing was changed."],
    };
  }

  const { evidence, warnings } = await collectAdvancementEvidence(db, now);
  const verdicts = evidence.map((e) => evaluateAdvancement(e, now));
  const applied: AdvancementRun["applied"] = [];

  for (const verdict of verdicts) {
    if (verdict.action === "hold" || !verdict.target || !verdict.stage) continue;
    const result = await transitionStage(db, {
      symbol: verdict.instrument,
      to: verdict.target,
      expectedFrom: verdict.stage,
      approver: AUTO_APPROVER,
      reason: `Automatic advancement on ${utcDay(now)}: every gate for ${verdict.target} was met on recorded evidence.`,
      evidence: {
        action: verdict.action,
        reasons: verdict.reasons,
        window_days: ADVANCEMENT_WINDOW_DAYS,
        evaluated_at: now.toISOString(),
      },
    });
    applied.push({
      instrument: verdict.instrument,
      from: verdict.stage,
      to: verdict.target,
      action: verdict.action,
      ok: result.ok,
      ...(result.error ? { error: result.error } : {}),
    });
  }

  return { ranAt: now.toISOString(), enabled: true, verdicts, applied, warnings };
}
