/**
 * Instrument-aware price precision (Phase A1, Finding 7).
 *
 * Before this module every price in the V1 path was rounded to five decimals.
 * That is correct for EURUSD and GBPAUD, harmless for XAUUSD (a 2-digit symbol
 * rounded to 5 is unchanged), and WRONG for a 3-digit symbol such as USDJPY,
 * where a 5-decimal "price" is not on any broker's grid.
 *
 * THREE DIFFERENT PRECISIONS, deliberately not unified:
 *
 *   1. calculation precision — none. Indicators, ATR and R multiples stay in full
 *      double precision; rounding intermediate maths is how R drifts.
 *   2. storage / display / research precision — `priceDecimals()`. Broker `digits`
 *      when a specification has been fetched, otherwise the registry's
 *      `fallbackDigits`. Never used to build a broker order.
 *   3. broker order precision — `normalizeToTick()`. The live `tickSize` (or
 *      `point`) is the ONLY authority for a price sent to a broker, because it is
 *      the grid the broker will accept or reject against.
 *
 * WAVE 0 PARITY: `entryPriceKey()` is the duplicate-identity function that used
 * to be `price.toFixed(5)`. XAUUSD (2), GBPAUD (5) and EURUSD (5) all produce the
 * byte-identical key they produced before, which is pinned by test. Only symbols
 * that were never live can change.
 */
import type { SizingSpec } from "@/lib/broker/specs";
import { instrumentDefinition } from "./registry";

/** Legacy fixed precision, kept only so parity assertions can name it. */
export const LEGACY_PRICE_DECIMALS = 5;

/**
 * Decimals for storing, displaying and keying a price.
 *
 * Broker `digits` wins when present: it is the broker's own statement about the
 * symbol. The registry fallback exists so a symbol with no fetched specification
 * still renders sensibly — it is explicitly NOT an execution authority.
 */
export function priceDecimals(symbol: string, spec?: SizingSpec | null): number {
  const brokerDigits = spec?.digits;
  if (typeof brokerDigits === "number" && Number.isInteger(brokerDigits) && brokerDigits >= 0) {
    return brokerDigits;
  }
  return instrumentDefinition(symbol)?.fallbackDigits ?? LEGACY_PRICE_DECIMALS;
}

/** Round for storage/display. Half-up, symmetric — no risk semantics attached. */
export function roundPrice(symbol: string, price: number, spec?: SizingSpec | null): number {
  return Number(price.toFixed(priceDecimals(symbol, spec)));
}

/**
 * Duplicate identity for an active setup.
 *
 * A string, not a number, so "1.10" and "1.1" cannot become two identities. For
 * Wave 0 this is exactly the previous `toFixed(5)` string for GBPAUD/EURUSD and
 * a stable 2-decimal string for XAUUSD.
 */
export function entryPriceKey(symbol: string, price: number, spec?: SizingSpec | null): string {
  return price.toFixed(priceDecimals(symbol, spec));
}

/** The grid a broker order price must sit on, or null when unknown. */
export function tickGrid(spec: SizingSpec | null | undefined): number | null {
  if (!spec) return null;
  if (typeof spec.tickSize === "number" && spec.tickSize > 0) return spec.tickSize;
  if (typeof spec.point === "number" && spec.point > 0) return spec.point;
  return null;
}

/**
 * The ROLE a price plays on a broker order (Phase A2A, R2-FIX).
 *
 * The direction to snap in depends on the role, not on a vague notion of
 * "safer" — the previous `safer_stop` / `safer_limit` pair used the identical
 * branch and therefore rounded a take-profit optimistically:
 *
 *   `entry_limit`  — long DOWN, short UP: harder to fill, never a worse fill
 *                    than the price the trader was shown.
 *   `stop_loss`    — long DOWN, short UP: away from entry, so structural
 *                    clearance is preserved. Risk-per-unit is then RE-DERIVED
 *                    from the snapped price; it is never assumed unchanged.
 *   `take_profit`  — long UP, short DOWN: harder to fill, never an optimistic
 *                    target that would overstate R.
 *   `display`      — nearest; telemetry and UI only, never sent to a broker.
 */
export type OrderPriceRole = "entry_limit" | "stop_loss" | "take_profit" | "display";

export interface NormalizedPrice {
  price: number;
  /** Grid actually applied; null means "no broker grid was available". */
  tick: number | null;
  source: "tick_size" | "point" | "unnormalized";
  moved: boolean;
}

/**
 * Snap a price onto the broker's tick grid for a specific order role.
 *
 * When no grid is available the price is returned untouched and flagged
 * `unnormalized` — the caller decides whether that is acceptable. Silently
 * inventing a grid would be a fabricated broker fact, and the submission path
 * refuses instead (`no_execution_grid`).
 */
export function normalizeToTick(args: {
  price: number;
  spec: SizingSpec | null | undefined;
  role: OrderPriceRole;
  direction: "long" | "short";
}): NormalizedPrice {
  const tick = tickGrid(args.spec);
  if (tick === null || !Number.isFinite(args.price)) {
    return { price: args.price, tick: null, source: "unnormalized", moved: false };
  }
  const source: NormalizedPrice["source"] =
    args.spec?.tickSize && args.spec.tickSize > 0 ? "tick_size" : "point";

  const up = () => Math.ceil(args.price / tick) * tick;
  const down = () => Math.floor(args.price / tick) * tick;
  const long = args.direction === "long";

  let raw: number;
  switch (args.role) {
    case "display":
      raw = Math.round(args.price / tick) * tick;
      break;
    case "take_profit":
      // Harder to fill: a long target moves up, a short target moves down.
      raw = long ? up() : down();
      break;
    case "entry_limit":
    case "stop_loss":
      // Entry: harder to fill. Stop: away from entry. Both are long-down.
      raw = long ? down() : up();
      break;
  }

  // Tick grids are decimal fractions; snapping in floating point leaves residue
  // such as 1.2345000000000002, which a broker rejects as off-grid.
  const decimals = tickDecimals(tick);
  const price = Number(raw.toFixed(decimals));
  return { price, tick, source, moved: price !== args.price };
}

/** One order's geometry after every price has been snapped to the broker grid. */
export interface NormalizedGeometry {
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number | null;
  /** Grid applied to every leg; null means the broker grid was unknown. */
  tick: number | null;
  source: NormalizedPrice["source"];
  /** True when any leg actually moved, so reconciliation can explain the diff. */
  moved: boolean;
}

/**
 * Normalize a whole plan for submission.
 *
 * Every leg is snapped by its own role, so the result can never be an optimistic
 * target paired with a widened stop. The caller must reject when `tick` is null
 * and the destination is a real broker.
 */
export function normalizeOrderGeometry(args: {
  spec: SizingSpec | null | undefined;
  direction: "long" | "short";
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number | null;
}): NormalizedGeometry {
  const at = (price: number, role: OrderPriceRole) =>
    normalizeToTick({ price, spec: args.spec, role, direction: args.direction });

  const entry = at(args.entryPrice, "entry_limit");
  const stop = at(args.stopLoss, "stop_loss");
  const tp1 = at(args.tp1, "take_profit");
  const tp2 = at(args.tp2, "take_profit");
  const tp3 = args.tp3 === null ? null : at(args.tp3, "take_profit");

  return {
    entryPrice: entry.price,
    stopLoss: stop.price,
    tp1: tp1.price,
    tp2: tp2.price,
    tp3: tp3 === null ? null : tp3.price,
    tick: entry.tick,
    source: entry.source,
    moved: entry.moved || stop.moved || tp1.moved || tp2.moved || (tp3?.moved ?? false),
  };
}

/** Decimals implied by a tick size (0.001 -> 3, 0.25 -> 2). */
export function tickDecimals(tick: number): number {
  if (!Number.isFinite(tick) || tick <= 0) return LEGACY_PRICE_DECIMALS;
  const text = tick.toExponential();
  const [mantissa, exponent] = text.split("e");
  const exp = Number(exponent);
  const mantissaDecimals = ((mantissa ?? "").split(".")[1] ?? "").replace(/0+$/, "").length;
  return Math.max(0, mantissaDecimals - exp);
}
