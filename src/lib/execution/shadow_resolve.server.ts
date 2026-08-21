/**
 * Hourly resolution loop.
 *
 * One batched M15 candle fetch per instrument (max 3 per run), then a pure
 * replay of every open shadow row for that instrument. Idempotent: rows are
 * written only when their state actually advanced.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
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
}

export interface ResolveSummary {
  scanned: number;
  advanced: number;
  resolved: number;
  instruments: Array<{ instrument: string; candles: number; error?: string }>;
  fetchFailures: number;
}

const OPEN_ROW_COLUMNS =
  "id, signal_id, instrument, direction, detected_at, entry_price, stop_loss, tp1, tp2, tp3, tp1_r, tp2_r, tp3_r, risk_price, atr, filled_at, fill_price, execution_slippage_pips, max_favorable_excursion_r, max_adverse_excursion_r, bars_replayed, replay_cursor, model_version";

/**
 * Per-version budget. The production cohort is read FIRST and may consume the
 * whole allowance; research cohorts get only what is left over. Without this
 * split a large V2 backlog would interleave by `detected_at` and delay the
 * resolution of the live model that feeds the priors and the weekly report.
 */
async function loadOpenRows(db: SupabaseClient): Promise<ShadowRow[]> {
  const primary = await db
    .from("shadow_executions")
    .select(OPEN_ROW_COLUMNS)
    .in("status", ["pending", "open"])
    .eq("model_version", ACTIVE_MODEL_VERSION)
    .order("detected_at", { ascending: true })
    .limit(MAX_ROWS_PER_RUN);
  if (primary.error) throw new Error(`shadow_executions read failed: ${primary.error.message}`);

  const rows = (primary.data ?? []) as unknown as ShadowRow[];
  const spare = MAX_ROWS_PER_RUN - rows.length;
  if (spare <= 0) return rows;

  const research = await db
    .from("shadow_executions")
    .select(OPEN_ROW_COLUMNS)
    .in("status", ["pending", "open"])
    .neq("model_version", ACTIVE_MODEL_VERSION)
    .order("detected_at", { ascending: true })
    .limit(spare);
  // A research-cohort read failure must never abort production resolution.
  if (research.error) {
    console.error("[shadow-resolve] research cohort read failed:", research.error.message);
    return rows;
  }
  return rows.concat((research.data ?? []) as unknown as ShadowRow[]);
}

export async function resolveShadowExecutions(db: SupabaseClient): Promise<ResolveSummary> {
  const rows = await loadOpenRows(db);
  const summary: ResolveSummary = {
    scanned: rows.length,
    advanced: 0,
    resolved: 0,
    instruments: [],
    fetchFailures: 0,
  };
  if (rows.length === 0) return summary;

  const byInstrument = new Map<string, ShadowRow[]>();
  for (const row of rows) {
    const list = byInstrument.get(row.instrument) ?? [];
    list.push(row);
    byInstrument.set(row.instrument, list);
  }

  for (const [instrument, group] of byInstrument) {
    let candles;
    try {
      candles = await fetchCandles(instrument, "M15", CANDLE_DEPTH);
    } catch (err) {
      // Timeouts, 504s and closed-market responses are expected. Skip the
      // instrument; the next hourly pass replays from the same cursor.
      summary.fetchFailures += 1;
      summary.instruments.push({ instrument, candles: 0, error: describeError(err) });
      continue;
    }
    summary.instruments.push({ instrument, candles: candles.length });

    for (const row of group) {
      const input: ReplayInput = {
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
  }

  return summary;
}

function round(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(4)) : null;
}
