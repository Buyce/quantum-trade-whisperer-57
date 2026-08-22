/**
 * The complete UTC-day eligibility frame.
 *
 * The feed's `signalsQuery` is a 400-row DISPLAY window and can never be the
 * daily-cap authority: on a busy day it truncates, and a truncated frame changes
 * which signals are inside the cap. This module pages through every signal
 * detected since UTC midnight and is the single source used by both the client
 * (feed, cap badge, realtime toast) and the server (alert fan-out), so the two
 * cannot disagree.
 *
 * Only the columns eligibility actually needs are selected, so the extra query is
 * cheap even at thousands of rows per day.
 */
import { contextOf, type Grade, type SignalRow } from "@/lib/db-types";
import { utcDayStart, type EligibilitySignal } from "./eligibility";

const PAGE_SIZE = 1000;

/** Minimal shape of the Supabase clients used on both sides of the app. */
export interface FrameClient {
  from: (table: string) => {
    select: (columns: string) => {
      gte: (
        column: string,
        value: string,
      ) => {
        order: (
          column: string,
          opts: { ascending: boolean },
        ) => {
          range: (
            from: number,
            to: number,
          ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
        };
      };
    };
  };
}

interface FrameRow {
  id: string;
  detected_at: string;
  instrument: string;
  grade: Grade;
  market_context?: { trading_session: string }[] | { trading_session: string } | null;
}

/** Normalises a signal row (feed or frame shape) into the eligibility input. */
export function toEligibilitySignal(
  row: Pick<SignalRow, "id" | "detected_at" | "instrument" | "grade" | "market_context">,
): EligibilitySignal {
  return {
    id: row.id,
    detected_at: row.detected_at,
    instrument: row.instrument,
    grade: row.grade,
    trading_session: contextOf(row as SignalRow)?.trading_session ?? null,
  };
}

/**
 * Every signal detected since UTC midnight, paginated to completion. Throws on a
 * read error: an incomplete frame must never be silently treated as complete,
 * because that would understate cap consumption.
 */
export async function fetchDayFrame(
  client: FrameClient,
  now: number = Date.now(),
): Promise<EligibilitySignal[]> {
  const since = new Date(utcDayStart(now)).toISOString();
  const rows: EligibilitySignal[] = [];
  for (let page = 0; ; page += 1) {
    const { data, error } = await client
      .from("scanned_signals")
      .select("id, detected_at, instrument, grade, market_context(trading_session)")
      .gte("detected_at", since)
      .order("detected_at", { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as unknown as FrameRow[];
    for (const row of batch) {
      rows.push(
        toEligibilitySignal(
          row as unknown as Pick<
            SignalRow,
            "id" | "detected_at" | "instrument" | "grade" | "market_context"
          >,
        ),
      );
    }
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}
