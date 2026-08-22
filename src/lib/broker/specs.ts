/**
 * Broker symbol specifications — pure layer (Prompt 12).
 *
 * VERIFIED FACT (one-off authenticated read, 2026-08-22): the MetaApi client API
 * exposes `/users/current/accounts/{id}/symbols/{symbol}/specification` and
 * returns, for our three instruments: `contractSize`, `tickSize`, `digits`,
 * `minVolume`, `maxVolume`, `volumeStep`, `baseCurrency`, `profitCurrency`,
 * `marginCurrency`, `priceCalculationMode`, and (per symbol) `stopsLevel`,
 * `freezeLevel`, `tradeMode`, `TickValue`. Fields the broker omits stay NULL —
 * they are never defaulted, so a check on an absent field reports "unknown"
 * rather than "pass".
 *
 * The static table below is a documented instrument fact, not market data, and
 * is always labelled `static_v1` so it can never be read as broker-confirmed.
 */
import { CONTRACT_SPECS } from "@/lib/risk";

export type SpecSource = "broker" | "static_v1";

/** Everything the sizing math may consult about one symbol. */
export interface SizingSpec {
  symbol: string;
  contractSize: number;
  base: string;
  /** Currency the price — and therefore the raw risk — is denominated in. */
  quote: string;
  lotStep: number;
  minLot: number;
  /** Broker volume ceiling; null when unknown. */
  maxLot: number | null;
  /** Broker aggregate volume limit for the symbol; null when unknown. */
  volumeLimit: number | null;
  /** Price increment of one tick (the smallest quoted price change). */
  tickSize: number | null;
  /**
   * MT5 SYMBOL_POINT: the price value of one "point", i.e. 10^-digits. This is
   * the unit `stopsLevel` and `freezeLevel` are expressed in, and it is NOT
   * necessarily equal to `tickSize` (a symbol may quote in multi-point ticks).
   */
  point: number | null;
  /** Where `point` came from: the broker field, or derived from `digits`. */
  pointSource: "broker_point" | "derived_from_digits" | null;
  /** Minimum stop distance in points; null when unknown (never assumed zero). */
  stopsLevel: number | null;
  freezeLevel: number | null;
  digits: number | null;
  tradeMode: string | null;
  calcMode: string | null;
  marginCurrency: string | null;
  source: SpecSource;
  /** When the broker row was fetched. Null for the static table. */
  asOf: string | null;
}

/** Row shape of `public.broker_symbol_specs`. */
export interface BrokerSpecRow {
  symbol: string;
  contract_size: number | string | null;
  tick_size: number | string | null;
  tick_value: number | string | null;
  volume_min: number | string | null;
  volume_max: number | string | null;
  volume_step: number | string | null;
  volume_limit: number | string | null;
  stops_level: number | string | null;
  freeze_level: number | string | null;
  digits: number | string | null;
  base_currency: string | null;
  profit_currency: string | null;
  margin_currency: string | null;
  trade_mode: string | null;
  calc_mode: string | null;
  point?: number | string | null;
  point_source?: string | null;
  fetched_at: string;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Documented contract facts, always labelled as broker-unconfirmed. */
export function staticSpec(instrument: string): SizingSpec | null {
  const s = CONTRACT_SPECS[instrument];
  if (!s) return null;
  return {
    symbol: instrument,
    contractSize: s.contractSize,
    base: s.base,
    quote: s.quote,
    lotStep: s.lotStep,
    minLot: s.minLot,
    maxLot: null,
    volumeLimit: null,
    tickSize: null,
    point: null,
    pointSource: null,
    stopsLevel: null,
    freezeLevel: null,
    digits: null,
    tradeMode: null,
    calcMode: null,
    marginCurrency: null,
    source: "static_v1",
    asOf: null,
  };
}

/**
 * Broker row -> sizing spec. Returns null when the row lacks the fields the
 * math cannot work without (contract size, lot step, currencies): a partial
 * spec must never be completed with guesses.
 */
export function specFromRow(row: BrokerSpecRow): SizingSpec | null {
  const contractSize = num(row.contract_size);
  const lotStep = num(row.volume_step);
  const minLot = num(row.volume_min);
  const base = row.base_currency;
  const quote = row.profit_currency;
  if (!contractSize || contractSize <= 0) return null;
  if (!lotStep || lotStep <= 0) return null;
  if (!minLot || minLot <= 0) return null;
  if (!base || !quote) return null;
  return {
    symbol: row.symbol,
    contractSize,
    base,
    quote,
    lotStep,
    minLot,
    maxLot: num(row.volume_max),
    volumeLimit: num(row.volume_limit),
    tickSize: num(row.tick_size),
    point: num(row.point ?? null),
    pointSource:
      row.point_source === "broker_point" || row.point_source === "derived_from_digits"
        ? row.point_source
        : null,
    stopsLevel: num(row.stops_level),
    freezeLevel: num(row.freeze_level),
    digits: num(row.digits),
    tradeMode: row.trade_mode,
    calcMode: row.calc_mode,
    marginCurrency: row.margin_currency,
    source: "broker",
    asOf: row.fetched_at,
  };
}

/** Raw MetaApi specification payload (only the fields we persist). */
export interface RawSpecification {
  symbol?: string;
  contractSize?: number;
  tickSize?: number;
  TickValue?: number;
  tickValue?: number;
  minVolume?: number;
  maxVolume?: number;
  volumeStep?: number;
  volumeLimit?: number;
  stopsLevel?: number;
  freezeLevel?: number;
  digits?: number;
  baseCurrency?: string;
  profitCurrency?: string;
  marginCurrency?: string;
  tradeMode?: string;
  priceCalculationMode?: string;
  /** Present on some brokers; when absent we derive point from `digits`. */
  point?: number;
}

/**
 * VERIFIED SEMANTICS: MT5 exposes SYMBOL_POINT = 10^-SYMBOL_DIGITS, and
 * SYMBOL_TRADE_STOPS_LEVEL is expressed in POINTS, not ticks. MetaApi's
 * specification payload always carries `digits`; `tickSize` is the minimum
 * price change, which can be a multiple of a point. We therefore prefer an
 * explicit broker `point` field and otherwise derive it from `digits`. We never
 * substitute `tickSize` for `point`.
 */
export function derivePoint(raw: RawSpecification): {
  point: number | null;
  source: "broker_point" | "derived_from_digits" | null;
} {
  const explicit = num(raw.point);
  if (explicit && explicit > 0) return { point: explicit, source: "broker_point" };
  const digits = num(raw.digits);
  if (digits !== null && digits >= 0 && Number.isInteger(digits)) {
    return { point: Number(Math.pow(10, -digits).toFixed(12)), source: "derived_from_digits" };
  }
  return { point: null, source: null };
}

/** MetaApi payload -> upsert row. Absent fields stay null. */
export function rowFromSpecification(symbol: string, raw: RawSpecification) {
  const point = derivePoint(raw);
  return {
    symbol,
    contract_size: num(raw.contractSize),
    tick_size: num(raw.tickSize),
    tick_value: num(raw.TickValue ?? raw.tickValue),
    volume_min: num(raw.minVolume),
    volume_max: num(raw.maxVolume),
    volume_step: num(raw.volumeStep),
    volume_limit: num(raw.volumeLimit),
    stops_level: num(raw.stopsLevel),
    freeze_level: num(raw.freezeLevel),
    digits: num(raw.digits),
    base_currency: raw.baseCurrency ?? null,
    profit_currency: raw.profitCurrency ?? null,
    margin_currency: raw.marginCurrency ?? null,
    trade_mode: raw.tradeMode ?? null,
    calc_mode: raw.priceCalculationMode ?? null,
    point: point.point,
    point_source: point.source,
    raw: raw as unknown as Record<string, unknown>,
    fetched_at: new Date().toISOString(),
    source: "metaapi_specification",
  };
}

/**
 * Minimum stop distance in price, or null when the broker did not tell us.
 * stopsLevel is denominated in POINTS, so the conversion uses `point`
 * (10^-digits), never `tickSize`.
 */
export function minStopDistance(spec: SizingSpec): number | null {
  if (spec.stopsLevel === null || spec.point === null || spec.point <= 0) return null;
  return spec.stopsLevel * spec.point;
}

/** A broker row older than this is stale and reported as such. */
export const SPEC_MAX_AGE_MS = 36 * 60 * 60 * 1000;

export function isSpecStale(spec: SizingSpec, now = Date.now()): boolean {
  if (spec.source !== "broker" || !spec.asOf) return false;
  return now - new Date(spec.asOf).getTime() > SPEC_MAX_AGE_MS;
}
