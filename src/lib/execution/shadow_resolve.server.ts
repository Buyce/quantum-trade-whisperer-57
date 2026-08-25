/**
 * Hourly resolution loop.
 *
 * One batched M15 candle fetch per instrument (max 3 per run), then a pure
 * replay of every open shadow row for that instrument. Idempotent: rows are
 * written only when their state actually advanced.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertCapability } from "@/lib/instruments/lifecycle.server";
import { fetchCandles } from "@/lib/scanner/metaapi.server";
import { describeError } from "@/lib/scanner/pipeline.server";
import { ACTIVE_MODEL_VERSION } from "@/lib/versioning";
import { replaySetup, type ReplayInput } from "./replay";
import { replaySetupV2 } from "./replay-v2";
import { REPLAY_V1_VERSION, REPLAY_V2_VERSION } from "./replay-registry";

const MAX_ROWS_PER_RUN = 200;
/**
 * Replay-V2 gets its OWN budget on top of the production one, so a research
 * backlog can never displace a single Replay-V1 row. It is deliberately small:
 * research throughput is a nice-to-have, production labelling is not.
 */
const RESEARCH_MAX_ROWS_PER_RUN = 60;
/**
 * Research-candidate rows (cohort = 'research_candidate') have a THIRD budget,
 * read from `shadow_engine_state.candidate_rows_per_run`. Production is loaded
 * first, from an explicitly production-only query, so candidate backlog can
 * never consume a production slot no matter how large it grows.
 */
const CANDIDATE_ROWS_FALLBACK = 0;
/** The only cohort any production aggregate or production replay may read. */
const PRODUCTION_COHORT = "production";
/** Forward-tested research candidates. Never trader-visible. */
const CANDIDATE_COHORT = "research_candidate";
/** Model cohorts are resolved strictly in this order. */
const MODEL_PRIORITY = [1, 2, 3] as const;

/**
 * 1000 M15 bars is ~10 days of session time — deep enough to replay a backlog
 * from the start of the dataset, not just the last day.
 */
const CANDLE_DEPTH = 1000;

interface ShadowRow {
  id: string;
  signal_id: string;
  instrument: string;
  direction: "long" | "short";
  detected_at: string;
  entry_price: number;
  stop_loss: number;
  tp1: number;
  tp2: number;
  tp3: number | null;
  tp1_r: number | null;
  tp2_r: number | null;
  tp3_r: number | null;
  risk_price: number;
  atr: number | null;
  filled_at: string | null;
  fill_price: number | null;
  execution_slippage_pips: number | null;
  max_favorable_excursion_r: number | null;
  max_adverse_excursion_r: number | null;
  bars_replayed: number;
  replay_cursor: string | null;
  model_version: number;
  replay_version: number;
}

export interface ResolveSummary {
  scanned: number;
  advanced: number;
  resolved: number;
  instruments: Array<{ instrument: string; candles: number; error?: string }>;
  fetchFailures: number;
  /** Research (Replay-V2) rows advanced this run. Never affects production counts. */
  researchScanned: number;
  researchAdvanced: number;
  /** Research-candidate (cohort) rows advanced this run. Separate budget. */
  candidateScanned: number;
  candidateAdvanced: number;
  /**
   * Candidate rows left in backlog because production fetched no candles for
   * their instrument this run. Surfaced so a starved backlog is visible in
   * coverage/health telemetry rather than looking like zero candidates.
   */
  candidateBacklogNoCandles: number;
}

const OPEN_ROW_COLUMNS =
  "id, signal_id, instrument, direction, detected_at, entry_price, stop_loss, tp1, tp2, tp3, tp1_r, tp2_r, tp3_r, risk_price, atr, filled_at, fill_price, execution_slippage_pips, max_favorable_excursion_r, max_adverse_excursion_r, bars_replayed, replay_cursor, model_version, replay_version";

/**
 * Production (Replay-V1) rows, resolved in a strict model hierarchy: the live
 * model may consume the whole allowance, then V2, then V3. Without this split a
 * large research backlog would interleave by `detected_at` and delay the
 * resolution of the live model that feeds the priors and the weekly report.
 *
 * The `cohort` predicate is explicit and non-negotiable: this query defines
 * production replay capacity, so a research-candidate row must be unable to
 * appear in it even by accident.
 */
async function loadOpenRows(db: SupabaseClient): Promise<ShadowRow[]> {
  const ordered: number[] = [
    ACTIVE_MODEL_VERSION,
    ...MODEL_PRIORITY.filter((v) => v !== ACTIVE_MODEL_VERSION),
  ];
  const rows: ShadowRow[] = [];

  for (const modelVersion of ordered) {
    const budget = MAX_ROWS_PER_RUN - rows.length;
    if (budget <= 0) break;
    const res = await db
      .from("shadow_executions")
      .select(OPEN_ROW_COLUMNS)
      .in("status", ["pending", "open"])
      .eq("cohort", PRODUCTION_COHORT)
      .eq("replay_version", REPLAY_V1_VERSION)
      .eq("model_version", modelVersion)
      .order("detected_at", { ascending: true })
      .limit(budget);
    if (res.error) {
      // Only the live cohort is allowed to abort the run.
      if (modelVersion === ACTIVE_MODEL_VERSION) {
        throw new Error(`shadow_executions read failed: ${res.error.message}`);
      }
      console.error(`[shadow-resolve] model ${modelVersion} read failed:`, res.error.message);
      continue;
    }
    rows.push(...((res.data ?? []) as unknown as ShadowRow[]));
  }
  return rows;
}

/** True only when the DB kill switch enables Replay-V2 research resolution. */
async function isReplayV2Enabled(db: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await db
      .from("shadow_engine_state")
      .select("replay_v2_shadow_enabled")
      .eq("id", true)
      .maybeSingle();
    if (error) return false;
    return Boolean(
      (data as { replay_v2_shadow_enabled?: boolean } | null)?.replay_v2_shadow_enabled,
    );
  } catch {
    return false;
  }
}

/**
 * Candidate resolver budget, read from the database so it can be tuned without
 * a deploy. Any failure yields 0 — the switch fails closed.
 */
async function candidateBudget(db: SupabaseClient): Promise<number> {
  try {
    const { data, error } = await db
      .from("shadow_engine_state")
      .select("candidate_rows_per_run")
      .eq("id", true)
      .maybeSingle();
    if (error) return CANDIDATE_ROWS_FALLBACK;
    const n = Number((data as { candidate_rows_per_run?: number } | null)?.candidate_rows_per_run);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : CANDIDATE_ROWS_FALLBACK;
  } catch {
    return CANDIDATE_ROWS_FALLBACK;
  }
}

/**
 * Research (Replay-V2) rows. Read from a SEPARATE bounded budget so they can
 * never reduce Replay-V1 throughput, and always fail open: a research read
 * error leaves production resolution untouched. Replay-V2 siblings exist only
 * for the production cohort, and the predicate says so explicitly.
 */
async function loadResearchRows(db: SupabaseClient): Promise<ShadowRow[]> {
  if (!(await isReplayV2Enabled(db))) return [];
  const res = await db
    .from("shadow_executions")
    .select(OPEN_ROW_COLUMNS)
    .in("status", ["pending", "open"])
    .eq("cohort", PRODUCTION_COHORT)
    .eq("replay_version", REPLAY_V2_VERSION)
    .order("detected_at", { ascending: true })
    .limit(RESEARCH_MAX_ROWS_PER_RUN);
  if (res.error) {
    console.error("[shadow-resolve] replay-v2 read failed:", res.error.message);
    return [];
  }
  return (res.data ?? []) as unknown as ShadowRow[];
}

/**
 * Research-candidate rows: Replay-V1 semantics, own bounded budget, loaded LAST
 * and never able to shrink the production query above. Fails open.
 */
async function loadCandidateRows(db: SupabaseClient): Promise<ShadowRow[]> {
  const budget = await candidateBudget(db);
  if (budget <= 0) return [];
  const res = await db
    .from("shadow_executions")
    .select(OPEN_ROW_COLUMNS)
    .in("status", ["pending", "open"])
    .eq("cohort", CANDIDATE_COHORT)
    .eq("replay_version", REPLAY_V1_VERSION)
    .order("detected_at", { ascending: true })
    .limit(budget);
  if (res.error) {
    console.error("[shadow-resolve] candidate read failed:", res.error.message);
    return [];
  }
  return (res.data ?? []) as unknown as ShadowRow[];
}

function toReplayInput(row: ShadowRow): ReplayInput {
  return {
    direction: row.direction,
    instrument: row.instrument,
    detectedAt: row.detected_at,
    entryPrice: Number(row.entry_price),
    stopLoss: Number(row.stop_loss),
    tp1: Number(row.tp1),
    tp2: Number(row.tp2),
    tp3: row.tp3 == null ? null : Number(row.tp3),
    tp1R: row.tp1_r == null ? null : Number(row.tp1_r),
    tp2R: row.tp2_r == null ? null : Number(row.tp2_r),
    tp3R: row.tp3_r == null ? null : Number(row.tp3_r),
    riskPrice: Number(row.risk_price),
    atr: row.atr == null ? null : Number(row.atr),
    replayCursor: row.replay_cursor,
    filledAt: row.filled_at,
    fillPrice: row.fill_price == null ? null : Number(row.fill_price),
    mfeR: row.max_favorable_excursion_r == null ? null : Number(row.max_favorable_excursion_r),
    maeR: row.max_adverse_excursion_r == null ? null : Number(row.max_adverse_excursion_r),
    barsReplayed: row.bars_replayed ?? 0,
  };
}

/**
 * Resolve one Replay-V2 row against candles ALREADY fetched for production.
 * Never throws: research must not break the hourly production pass.
 */
async function resolveResearchRow(
  db: SupabaseClient,
  row: ShadowRow,
  candles: Awaited<ReturnType<typeof fetchCandles>>,
): Promise<boolean> {
  try {
    const state = replaySetupV2(toReplayInput(row), candles);
    const advanced = state.replayCursor !== row.replay_cursor || state.status === "resolved";
    const now = new Date().toISOString();
    if (!advanced) {
      await db.from("shadow_executions").update({ last_polled_at: now }).eq("id", row.id);
      return false;
    }
    const { error } = await db
      .from("shadow_executions")
      .update({
        status: state.status,
        filled_at: state.fillBarTime,
        fill_bar_time: state.fillBarTime,
        fill_price: state.fillPrice,
        risk_price_actual: state.riskPriceActual,
        execution_slippage_pips: state.slippagePips ?? row.execution_slippage_pips,
        max_favorable_excursion_r: round(state.mfeR),
        max_adverse_excursion_r: round(state.maeR),
        bars_replayed: state.barsReplayed,
        bars_to_outcome: state.barsToOutcome,
        gross_r: state.grossR == null ? null : round(state.grossR),
        // realized_r mirrors gross_r for Replay-V2 rows: there is no cost model,
        // so the two are equal by construction and readers stay uniform.
        realized_r: state.grossR == null ? null : round(state.grossR),
        net_r: null,
        resolved_outcome: state.outcome,
        data_quality_outcome:
          state.outcome === "invalid_plan" || state.outcome === "gap_beyond_stop"
            ? state.outcome
            : null,
        ml_target_label: state.label,
        replay_cursor: state.replayCursor,
        miss_distance_atr: state.missDistanceAtr,
        fill_gap_through: state.fillGapThrough,
        stop_gap_through: state.stopGapThrough,
        fill_ambiguous_tif: state.fillAmbiguousTif,
        fill_bar_excursion_ambiguous: state.fillBarExcursionAmbiguous,
        ambiguous_bars: state.ambiguousBars,
        ambiguous_bar_target_touch: state.ambiguousBarTargetTouch,
        adjudication: state.adjudication,
        tp1_before_stop: state.tp1BeforeStop,
        stop_before_tp1: state.stopBeforeTp1,
        first_target_touched: state.firstTargetTouched,
        max_target_touched: state.maxTargetTouched,
        last_polled_at: now,
        resolved_at: state.status === "resolved" ? now : null,
      })
      .eq("id", row.id);
    if (error) {
      console.error("[shadow-resolve] replay-v2 write failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[shadow-resolve] replay-v2 threw:", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Resolve one research-candidate row with Replay-V1 semantics, against candles
 * ALREADY fetched for production. Never throws and never fetches: a candidate
 * failure must be invisible to production resolution.
 */
async function resolveCandidateRow(
  db: SupabaseClient,
  row: ShadowRow,
  candles: Awaited<ReturnType<typeof fetchCandles>>,
): Promise<boolean> {
  try {
    const state = replaySetup(toReplayInput(row), candles);
    const advanced = state.replayCursor !== row.replay_cursor || state.status === "resolved";
    const now = new Date().toISOString();
    if (!advanced) {
      await db.from("shadow_executions").update({ last_polled_at: now }).eq("id", row.id);
      return false;
    }
    const { error } = await db
      .from("shadow_executions")
      .update({
        status: state.status,
        filled_at: state.filledAt,
        fill_price: state.fillPrice,
        execution_slippage_pips: state.slippagePips ?? row.execution_slippage_pips,
        max_favorable_excursion_r: round(state.mfeR),
        max_adverse_excursion_r: round(state.maeR),
        bars_replayed: state.barsReplayed,
        bars_to_outcome: state.barsToOutcome,
        realized_r: state.realizedR == null ? null : round(state.realizedR),
        resolved_outcome: state.outcome,
        ml_target_label: state.label,
        replay_cursor: state.replayCursor,
        miss_distance_atr: state.missDistanceAtr,
        last_polled_at: now,
        resolved_at: state.status === "resolved" ? now : null,
      })
      .eq("id", row.id);
    if (error) {
      console.error("[shadow-resolve] candidate write failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[shadow-resolve] candidate threw:", err instanceof Error ? err.message : err);
    return false;
  }
}

export async function resolveShadowExecutions(db: SupabaseClient): Promise<ResolveSummary> {
  const rows = await loadOpenRows(db);
  const researchRows = await loadResearchRows(db);
  const candidateRows = await loadCandidateRows(db);
  const summary: ResolveSummary = {
    scanned: rows.length,
    advanced: 0,
    resolved: 0,
    instruments: [],
    fetchFailures: 0,
    researchScanned: researchRows.length,
    researchAdvanced: 0,
    candidateScanned: candidateRows.length,
    candidateAdvanced: 0,
    candidateBacklogNoCandles: 0,
  };
  if (rows.length === 0 && researchRows.length === 0 && candidateRows.length === 0) return summary;

  const byInstrument = new Map<string, ShadowRow[]>();
  for (const row of rows) {
    const list = byInstrument.get(row.instrument) ?? [];
    list.push(row);
    byInstrument.set(row.instrument, list);
  }
  // Research rows never trigger their own provider call: they are grouped onto
  // the instruments production is already fetching, and skipped otherwise.
  const researchByInstrument = new Map<string, ShadowRow[]>();
  for (const row of researchRows) {
    if (!byInstrument.has(row.instrument)) continue;
    const list = researchByInstrument.get(row.instrument) ?? [];
    list.push(row);
    researchByInstrument.set(row.instrument, list);
  }
  // Same rule for candidates, and a starved backlog is counted rather than
  // silently dropped: zero incremental MetaApi calls is a hard requirement.
  const candidateByInstrument = new Map<string, ShadowRow[]>();
  for (const row of candidateRows) {
    if (!byInstrument.has(row.instrument)) {
      summary.candidateBacklogNoCandles += 1;
      continue;
    }
    const list = candidateByInstrument.get(row.instrument) ?? [];
    list.push(row);
    candidateByInstrument.set(row.instrument, list);
  }

  for (const [instrument, group] of byInstrument) {
    /**
     * Lifecycle data gate (Phase A2A, R6-FIX).
     *
     * Replay needs candles, and fetching candles is exactly `collect_data`, so a
     * disabled or suspended instrument is not fetched at all. Already-open rows
     * are deliberately NOT abandoned: they keep their cursor and resume from it
     * when the instrument is fetchable again, because discarding a forward
     * outcome would silently bias the research ledger.
     */
    const dataGate = await assertCapability(db, instrument, "collect_data");
    if (!dataGate.allowed) {
      summary.instruments.push({ instrument, candles: 0, error: dataGate.reason ?? "not in service" });
      summary.candidateBacklogNoCandles += (candidateByInstrument.get(instrument) ?? []).length;
      continue;
    }

    let candles;
    try {
      candles = await fetchCandles(instrument, "M15", CANDLE_DEPTH);
    } catch (err) {
      // Timeouts, 504s and closed-market responses are expected. Skip the
      // instrument; the next hourly pass replays from the same cursor.
      summary.fetchFailures += 1;
      summary.candidateBacklogNoCandles += (candidateByInstrument.get(instrument) ?? []).length;
      summary.instruments.push({ instrument, candles: 0, error: describeError(err) });
      continue;
    }

    summary.instruments.push({ instrument, candles: candles.length });

    for (const row of group) {
      const input = toReplayInput(row);

      const state = replaySetup(input, candles);
      const advanced = state.replayCursor !== row.replay_cursor || state.status === "resolved";
      const now = new Date().toISOString();

      if (!advanced) {
        await db.from("shadow_executions").update({ last_polled_at: now }).eq("id", row.id);
        continue;
      }

      const { error: updateError } = await db
        .from("shadow_executions")
        .update({
          status: state.status,
          filled_at: state.filledAt,
          fill_price: state.fillPrice,
          execution_slippage_pips: state.slippagePips ?? row.execution_slippage_pips,
          max_favorable_excursion_r: round(state.mfeR),
          max_adverse_excursion_r: round(state.maeR),
          bars_replayed: state.barsReplayed,
          bars_to_outcome: state.barsToOutcome,
          realized_r: state.realizedR == null ? null : round(state.realizedR),
          resolved_outcome: state.outcome,
          ml_target_label: state.label,
          replay_cursor: state.replayCursor,
          miss_distance_atr: state.missDistanceAtr,
          last_polled_at: now,
          resolved_at: state.status === "resolved" ? now : null,
        })
        .eq("id", row.id);
      if (updateError) throw new Error(`shadow_executions write failed: ${updateError.message}`);

      summary.advanced += 1;
      if (state.status === "resolved") summary.resolved += 1;
    }

    // Research phase — same immutable candle array, after production is done.
    for (const row of researchByInstrument.get(instrument) ?? []) {
      const advancedRow = await resolveResearchRow(db, row, candles);
      if (advancedRow) summary.researchAdvanced += 1;
    }

    // Candidate phase — last, same immutable candle array, zero extra fetches.
    for (const row of candidateByInstrument.get(instrument) ?? []) {
      const advancedRow = await resolveCandidateRow(db, row, candles);
      if (advancedRow) summary.candidateAdvanced += 1;
    }
  }

  return summary;
}

function round(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(4)) : null;
}
