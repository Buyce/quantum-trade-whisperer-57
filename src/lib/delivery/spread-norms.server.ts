/**
 * Read path for the adaptive spread norm.
 *
 * Reuses the hourly spread statistics already produced for instrument promotion
 * (`instrument_spread_stats`) — nothing new is collected. An unreadable or empty
 * table yields "not measured", which leaves the owner's fixed ceiling exactly as
 * it is: this gate can only tighten, so its absence is never a relaxation.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { spreadNorm, type SpreadNorm } from "./spread-norms";

/** Trailing window of trading days considered for the norm. */
export const NORM_WINDOW_DAYS = 21;

export async function loadSpreadNorm(
  db: Pick<SupabaseClient, "from">,
  instrument: string,
  session: string,
  now: number = Date.now(),
): Promise<SpreadNorm> {
  const since = new Date(now - NORM_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  let data: unknown[] | null = null;
  try {
    const res = await db
      .from("instrument_spread_stats")
      .select("trading_date, valid_samples, p90_spread_price")
      .eq("instrument", instrument)
      .eq("session", session)
      .gte("trading_date", since)
      .limit(200);
    if (res.error) return { measured: false, reason: "the spread statistics could not be read" };
    data = res.data ?? [];
  } catch {
    // No readable statistics means no adaptive tightening at all. This gate can
    // only reduce a ceiling, so its absence is never a relaxation.
    return { measured: false, reason: "the spread statistics could not be read" };
  }
  return spreadNorm(
    (data ?? []).map((row) => {
      const r = row as {
        trading_date: string;
        valid_samples: number;
        p90_spread_price: number | null;
      };
      return {
        tradingDate: String(r.trading_date),
        validSamples: Number(r.valid_samples),
        p90SpreadPrice: r.p90_spread_price === null ? null : Number(r.p90_spread_price),
      };
    }),
  );
}
