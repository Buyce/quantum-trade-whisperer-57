/**
 * Reads the stored market context for a setup about to be published.
 *
 * Read-only and advisory. Nothing in the scanner branches on the result: the
 * labels are stamped onto the row so a future audit can compare outcomes with
 * the dollar versus against it. Any missing series stays `null` — never "flat",
 * "calm" or "neutral" — and a read failure stamps nothing rather than guessing.
 */
import { alignmentOf, directionOf, positioningBias, volRegimeOf, type Observation } from "./derive";

interface MinimalClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

export interface ContextStamp {
  ctx_dollar_direction: string | null;
  ctx_yield_direction: string | null;
  ctx_alignment: string | null;
  ctx_vol_regime: string | null;
  ctx_positioning_bias: string | null;
  ctx_positioning_report_date: string | null;
  ctx_observed_at: string | null;
}

export const EMPTY_STAMP: ContextStamp = {
  ctx_dollar_direction: null,
  ctx_yield_direction: null,
  ctx_alignment: null,
  ctx_vol_regime: null,
  ctx_positioning_bias: null,
  ctx_positioning_report_date: null,
  ctx_observed_at: null,
};

/** Readings older than this are not context — they are history. */
export const MAX_CONTEXT_AGE_DAYS = 10;

/** The currency whose positioning report describes this pair's non-dollar leg. */
export function positioningCurrencyFor(symbol: string): string | null {
  const s = symbol.toUpperCase();
  if (s.length !== 6) return null;
  const base = s.slice(0, 3);
  const quote = s.slice(3);
  if (base === "USD")
    return ["EUR", "GBP", "JPY", "AUD", "CAD", "CHF"].includes(quote) ? quote : null;
  if (quote === "USD")
    return ["EUR", "GBP", "JPY", "AUD", "CAD", "CHF"].includes(base) ? base : null;
  return null;
}

export async function readContextStamp(
  db: MinimalClient,
  args: { instrument: string; direction: "long" | "short"; nowMs: number },
): Promise<ContextStamp> {
  const since = new Date(args.nowMs - MAX_CONTEXT_AGE_DAYS * 86_400_000).toISOString().slice(0, 10);

  try {
    const { data, error } = await db
      .from("market_context_series")
      .select("series_key, observation_date, value")
      .gte("observation_date", since)
      .order("observation_date", { ascending: false })
      .limit(400);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as { series_key: string; observation_date: string; value: number }[];
    const bucket = (key: string): Observation[] =>
      rows
        .filter((row) => row.series_key === key)
        .map((row) => ({ observationDate: row.observation_date, value: Number(row.value) }));

    const dollar = directionOf(bucket("dollar_index"));
    const yields = directionOf(bucket("us_10y_yield"));
    const vol = volRegimeOf(bucket("vix"));
    const alignment = alignmentOf(args.instrument, args.direction, dollar);

    let bias: string | null = null;
    let reportDate: string | null = null;
    const currency = positioningCurrencyFor(args.instrument);
    if (currency) {
      const { data: pos } = await db
        .from("positioning_snapshots")
        .select("report_date, net_contracts")
        .eq("currency", currency)
        .order("report_date", { ascending: false })
        .limit(1);
      const latest = (pos ?? [])[0] as
        { report_date: string; net_contracts: number | null } | undefined;
      if (latest) {
        bias = positioningBias(latest.net_contracts === null ? null : Number(latest.net_contracts));
        reportDate = bias ? latest.report_date : null;
      }
    }

    const anything = dollar || yields || vol || alignment || bias;
    return {
      ctx_dollar_direction: dollar,
      ctx_yield_direction: yields,
      ctx_alignment: alignment,
      ctx_vol_regime: vol,
      ctx_positioning_bias: bias,
      ctx_positioning_report_date: reportDate,
      ctx_observed_at: anything ? new Date(args.nowMs).toISOString() : null,
    };
  } catch (err) {
    // Context is advisory: a failed read must never block or alter publication,
    // and must never leave a guessed label behind.
    console.error("[market-context] stamp read failed:", err);
    return EMPTY_STAMP;
  }
}
