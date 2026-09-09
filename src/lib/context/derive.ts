/**
 * Pure market-context derivation.
 *
 * Turns stored intermarket series into three plain labels — dollar direction,
 * yield direction, volatility regime — plus whether a setup's direction agrees
 * with them. No fetching, no database, no clock: every input is passed in, so
 * every label is reproducible from the stored observations.
 *
 * The single rule this module exists to enforce: MISSING DATA IS NEVER NEUTRAL.
 * A series we could not read yields `null`, and a `null` never becomes "flat",
 * "calm" or "aligned". Callers must treat `null` as unknown.
 */

export type Direction = "up" | "down" | "flat";
export type VolRegime = "calm" | "normal" | "stressed";
export type Alignment = "aligned" | "against" | "neutral";

/** Series keys we store. Each maps to exactly one authoritative source series. */
export const SERIES_KEYS = [
  "dollar_index",
  "us_2y_yield",
  "us_10y_yield",
  "gold",
  "wti_oil",
  "vix",
] as const;

export type SeriesKey = (typeof SERIES_KEYS)[number];

/** One stored observation. */
export interface Observation {
  observationDate: string;
  value: number;
}

/** Percentage change below which a move is reported as flat rather than a trend. */
export const FLAT_BAND_PCT = 0.15;

/** VIX levels marking the regime boundaries. Levels, not forecasts. */
export const VIX_CALM_BELOW = 15;
export const VIX_STRESSED_AT_OR_ABOVE = 25;

/**
 * Direction of a series over its two most recent observations.
 *
 * Returns null when fewer than two observations exist: one point cannot show a
 * direction, and inventing "flat" from it would be a claim we cannot support.
 */
export function directionOf(
  observations: readonly Observation[],
  flatBandPct = FLAT_BAND_PCT,
): Direction | null {
  const usable = observations
    .filter((o) => Number.isFinite(o.value))
    .slice()
    .sort((a, b) => (a.observationDate < b.observationDate ? 1 : -1));
  if (usable.length < 2) return null;
  const latest = usable[0]!.value;
  const previous = usable[1]!.value;
  if (previous === 0) return null;
  const changePct = ((latest - previous) / Math.abs(previous)) * 100;
  if (Math.abs(changePct) < flatBandPct) return "flat";
  return changePct > 0 ? "up" : "down";
}

/** Volatility regime from the latest VIX level, or null when we hold none. */
export function volRegimeOf(observations: readonly Observation[]): VolRegime | null {
  const usable = observations
    .filter((o) => Number.isFinite(o.value))
    .slice()
    .sort((a, b) => (a.observationDate < b.observationDate ? 1 : -1));
  const latest = usable[0]?.value;
  if (typeof latest !== "number") return null;
  if (latest < VIX_CALM_BELOW) return "calm";
  if (latest >= VIX_STRESSED_AT_OR_ABOVE) return "stressed";
  return "normal";
}

/**
 * Which side of a pair the US dollar sits on.
 *
 * `base` means a rising dollar pushes the quoted price up (USDJPY, USDCAD,
 * USDCHF); `quote` means a rising dollar pushes it down (EURUSD, GBPUSD,
 * AUDUSD, XAUUSD). Anything else — crosses such as GBPAUD, indices, oil — has
 * no direct dollar leg here and returns null rather than a guess.
 */
export function dollarLeg(symbol: string): "base" | "quote" | null {
  const s = symbol.toUpperCase();
  if (s.length === 6 && s.startsWith("USD")) return "base";
  if (s.length === 6 && s.endsWith("USD")) return "quote";
  if (s === "XAUUSD" || s === "XAGUSD") return "quote";
  return null;
}

/**
 * Does a trade direction agree with the prevailing dollar move?
 *
 * Returns null when either the dollar direction or the pair's dollar leg is
 * unknown; "neutral" only when the dollar itself is genuinely flat.
 */
export function alignmentOf(
  symbol: string,
  tradeDirection: "long" | "short",
  dollarDirection: Direction | null,
): Alignment | null {
  if (!dollarDirection) return null;
  const leg = dollarLeg(symbol);
  if (!leg) return null;
  if (dollarDirection === "flat") return "neutral";
  // Expected price direction of this symbol if the dollar keeps moving this way.
  const expected: "long" | "short" =
    leg === "base"
      ? dollarDirection === "up"
        ? "long"
        : "short"
      : dollarDirection === "up"
        ? "short"
        : "long";
  return expected === tradeDirection ? "aligned" : "against";
}

/** Positioning bias from a stored net figure. Null stays null. */
export function positioningBias(
  netContracts: number | null | undefined,
): "long" | "short" | "flat" | null {
  if (typeof netContracts !== "number" || !Number.isFinite(netContracts)) return null;
  if (netContracts === 0) return "flat";
  return netContracts > 0 ? "long" : "short";
}
