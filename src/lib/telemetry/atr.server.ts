/**
 * ATR snapshot writer.
 *
 * Volatility context for a spread measurement must come from candles the scanner
 * ALREADY fetched during its own cycle. This module therefore never calls the
 * provider: it records a number that was computed upstream, together with the
 * bar it was computed as of, so a later reader can tell whether the volatility
 * context and the spread describe the same moment.
 *
 * A failed write is swallowed on purpose. Telemetry must never be able to break a
 * scan cycle; a missing snapshot simply means a later sample reports a null ATR
 * fraction instead of a guessed one.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Bump when the ATR computation itself changes. */
export const ATR_VERSION = 1 as const;

export interface AtrSnapshotInput {
  instrument: string;
  timeframe: "H4" | "H1" | "M15";
  atr: number;
  atrPeriod: number;
  /** Timestamp of the last candle the ATR was computed from. */
  candleAsOf: string;
}

type Db = Pick<SupabaseClient, "from">;

export async function recordAtrSnapshot(db: Db, input: AtrSnapshotInput): Promise<boolean> {
  if (!Number.isFinite(input.atr) || input.atr <= 0) return false;
  try {
    const { error } = await db.from("instrument_atr_snapshots").insert({
      instrument: input.instrument,
      timeframe: input.timeframe,
      atr: input.atr,
      atr_period: input.atrPeriod,
      atr_version: ATR_VERSION,
      candle_as_of: input.candleAsOf,
    });
    return !error;
  } catch {
    return false;
  }
}
