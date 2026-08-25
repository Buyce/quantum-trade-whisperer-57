/**
 * THE instrument definition authority (Phase A / A1).
 *
 * Before this module the same instrument universe was declared in four places
 * (`scanner/types.ts`, `db-types.ts`, `risk.ts` twice) plus a database column
 * default, and adding a pair meant an unsafe multi-file search-and-replace. Every
 * one of those constants is now derived from the table below.
 *
 * WHAT BELONGS HERE
 *   Stable, broker-independent identity: symbol, label, currencies, contract
 *   size, lot step/min, a fallback digit count, and which wave the pair belongs
 *   to.
 *
 * WHAT DOES NOT BELONG HERE
 *   - Broker-authoritative facts (`digits`, `point`, `stops_level`, `volume_*`,
 *     `trade_mode`) — those live in `broker_symbol_specs` /
 *     `connected_account_specs` and are fetched, never guessed.
 *   - Per-account symbol names — `connected_account_symbols`, resolved by
 *     `src/lib/accounts/symbol-map.ts`.
 *   - Operational state (which pairs may publish or execute) — that is the
 *     `instrument_lifecycle` table, read through `lifecycle.server.ts`.
 *
 * WAVE 0 IS FROZEN. Its numbers are copied byte-for-byte from the pre-registry
 * literals and pinned by `__tests__/registry-parity.test.ts`, so introducing the
 * registry cannot move a single V1 number.
 */

export type InstrumentWave = 0 | 1 | 2;

/**
 * The asset class an instrument belongs to (Wave 2).
 *
 * This is NOT decoration. It selects the market calendar, the spread reporting
 * unit, the sizing route and the strategy manifest. A pip is an FX concept; an
 * index has no pip at all, and an oil CFD's "point" is a broker fact rather than
 * a decimal convention. Anything that used to assume "FX or Gold" must now ask.
 */
export type AssetClass = "fx" | "metal" | "energy" | "index";

/**
 * How a spread/distance is honestly reported for an instrument.
 *
 *   `pip`         — FX convention (10 broker points on a 3/5-digit quote).
 *   `price`       — metals and energy: quote units, no pip claim.
 *   `index_point` — index CFDs: one index point, which is not a pip.
 */
export type PriceUnit = "pip" | "price" | "index_point";

export interface InstrumentDefinition {
  symbol: string;
  label: string;
  base: string;
  quote: string;
  assetClass: AssetClass;
  priceUnit: PriceUnit;
  /**
   * Units of the base currency in one standard lot.
   *
   * `null` means "the broker is the only authority and we have not fetched it".
   * Wave 2 CFDs enter that way deliberately: an invented contract size is an
   * invented position size.
   */
  contractSize: number | null;
  lotStep: number | null;
  minLot: number | null;
  /** Used ONLY for display/derivation when no broker spec has been fetched yet. */
  fallbackDigits: number;
  /**
   * Minimum stop buffer in absolute price terms.
   *
   * Wave 0 keeps its frozen V1 literals. Wave 1 and Wave 2 are deliberately
   * `null`: a plausible-looking guess (for example "0.02 for USDJPY") is exactly
   * the kind of unvalidated number this project forbids, so the floor must be
   * DERIVED from the broker's own `point`/`stops_level` plus a measured spread
   * before the pair may leave `disabled`.
   */
  spreadFloor: number | null;
  wave: InstrumentWave;
}

export const INSTRUMENT_DEFINITIONS: readonly InstrumentDefinition[] = [

  {
    symbol: "XAUUSD",
    label: "Gold",
    base: "XAU",
    quote: "USD",
    assetClass: "metal",
    priceUnit: "price",
    contractSize: 100,
    lotStep: 0.01,
    minLot: 0.01,
    fallbackDigits: 2,
    spreadFloor: 0.3,
    wave: 0,
  },
  {
    symbol: "GBPAUD",
    label: "GBP/AUD",
    base: "GBP",
    quote: "AUD",
    assetClass: "fx",
    priceUnit: "pip",
    contractSize: 100_000,
    lotStep: 0.01,
    minLot: 0.01,
    fallbackDigits: 5,
    spreadFloor: 0.0003,
    wave: 0,
  },
  {
    symbol: "EURUSD",
    label: "EUR/USD",
    base: "EUR",
    quote: "USD",
    assetClass: "fx",
    priceUnit: "pip",
    contractSize: 100_000,
    lotStep: 0.01,
    minLot: 0.01,
    fallbackDigits: 5,
    spreadFloor: 0.00015,
    wave: 0,
  },
  // ---- Wave 1: admitted for measurement only. No floor until measured. ----
  {
    symbol: "GBPUSD",
    label: "GBP/USD",
    base: "GBP",
    quote: "USD",
    assetClass: "fx",
    priceUnit: "pip",
    contractSize: 100_000,
    lotStep: 0.01,
    minLot: 0.01,
    fallbackDigits: 5,
    spreadFloor: null,
    wave: 1,
  },
  {
    symbol: "USDJPY",
    label: "USD/JPY",
    base: "USD",
    quote: "JPY",
    assetClass: "fx",
    priceUnit: "pip",
    contractSize: 100_000,
    lotStep: 0.01,
    minLot: 0.01,
    // JPY pairs are quoted to 3 decimals on this broker class, NOT 5. Every
    // price-unit calculation must use the broker's own point, not a shared default.
    fallbackDigits: 3,
    spreadFloor: null,
    wave: 1,
  },
  {
    symbol: "AUDUSD",
    label: "AUD/USD",
    base: "AUD",
    quote: "USD",
    assetClass: "fx",
    priceUnit: "pip",
    contractSize: 100_000,
    lotStep: 0.01,
    minLot: 0.01,
    fallbackDigits: 5,
    spreadFloor: null,
    wave: 1,
  },
  {
    symbol: "USDCAD",
    label: "USD/CAD",
    base: "USD",
    quote: "CAD",
    assetClass: "fx",
    priceUnit: "pip",
    contractSize: 100_000,
    lotStep: 0.01,
    minLot: 0.01,
    fallbackDigits: 5,
    spreadFloor: null,
    wave: 1,
  },
  {
    symbol: "USDCHF",
    label: "USD/CHF",
    base: "USD",
    quote: "CHF",
    assetClass: "fx",
    priceUnit: "pip",
    contractSize: 100_000,
    lotStep: 0.01,
    minLot: 0.01,
    fallbackDigits: 5,
    spreadFloor: null,
    wave: 1,
  },
  // ---- Wave 2: new asset classes, admitted as DEFINITIONS ONLY. -------------
  //
  // Contract size, lot step, minimum lot and the stop floor are all `null`: for a
  // metal, an energy CFD or an index CFD those are broker facts that vary between
  // brokers by an order of magnitude (1 vs 100 vs 5000 units per lot). Guessing
  // one would silently mis-size every order, so sizing REFUSES until the broker
  // specification has been fetched during `data_validation`.
  //
  // `quote` records the expected settlement currency for planning the conversion
  // route; readiness verifies it against the broker's own specification and marks
  // the instrument unready when they disagree.
  {
    symbol: "XAGUSD",
    label: "Silver",
    base: "XAG",
    quote: "USD",
    assetClass: "metal",
    priceUnit: "price",
    contractSize: null,
    lotStep: null,
    minLot: null,
    // Silver is commonly 3 digits where gold is 2. Display only, never execution.
    fallbackDigits: 3,
    spreadFloor: null,
    wave: 2,
  },
  {
    symbol: "USOIL",
    label: "WTI Crude",
    base: "USOIL",
    quote: "USD",
    assetClass: "energy",
    priceUnit: "price",
    contractSize: null,
    lotStep: null,
    minLot: null,
    fallbackDigits: 2,
    spreadFloor: null,
    wave: 2,
  },
  {
    symbol: "UKOIL",
    label: "Brent Crude",
    base: "UKOIL",
    quote: "USD",
    assetClass: "energy",
    priceUnit: "price",
    contractSize: null,
    lotStep: null,
    minLot: null,
    fallbackDigits: 2,
    spreadFloor: null,
    wave: 2,
  },
  {
    symbol: "NAS100",
    label: "US Tech 100",
    base: "NAS100",
    quote: "USD",
    assetClass: "index",
    priceUnit: "index_point",
    contractSize: null,
    lotStep: null,
    minLot: null,
    fallbackDigits: 2,
    spreadFloor: null,
    wave: 2,
  },
] as const;


const BY_SYMBOL = new Map(INSTRUMENT_DEFINITIONS.map((d) => [d.symbol, d]));

export function instrumentDefinition(symbol: string): InstrumentDefinition | undefined {
  return BY_SYMBOL.get(symbol);
}

export function isRegistrySymbol(symbol: string): boolean {
  return BY_SYMBOL.has(symbol);
}

/** Every symbol the registry knows about, in registry order. */
export const REGISTRY_SYMBOLS: readonly string[] = INSTRUMENT_DEFINITIONS.map((d) => d.symbol);

/**
 * The frozen production universe: the three pairs that were live before Phase A.
 *
 * This is what the scanner scans, what the settings UI offers, and what an empty
 * per-user instrument preference means. A Wave 1 pair joins only through its
 * lifecycle stage — never by widening a default.
 */
export const WAVE0_SYMBOLS: readonly string[] = INSTRUMENT_DEFINITIONS.filter(
  (d) => d.wave === 0,
).map((d) => d.symbol);

export const WAVE1_SYMBOLS: readonly string[] = INSTRUMENT_DEFINITIONS.filter(
  (d) => d.wave === 1,
).map((d) => d.symbol);

/** Wave 2: silver, the two crude benchmarks and the US tech index. Dark. */
export const WAVE2_SYMBOLS: readonly string[] = INSTRUMENT_DEFINITIONS.filter(
  (d) => d.wave === 2,
).map((d) => d.symbol);

export function assetClassOf(symbol: string): AssetClass | null {
  return instrumentDefinition(symbol)?.assetClass ?? null;
}

export function priceUnitOf(symbol: string): PriceUnit | null {
  return instrumentDefinition(symbol)?.priceUnit ?? null;
}

export function symbolsOfAssetClass(assetClass: AssetClass): readonly string[] {
  return INSTRUMENT_DEFINITIONS.filter((d) => d.assetClass === assetClass).map((d) => d.symbol);
}

export function instrumentLabels(): Record<string, string> {
  return Object.fromEntries(INSTRUMENT_DEFINITIONS.map((d) => [d.symbol, d.label]));
}

/**
 * Only instruments whose contract geometry is KNOWN appear here.
 *
 * A Wave 2 CFD has `null` contract size until the broker specification is
 * fetched, and it is therefore absent rather than present with a guess — a
 * missing key makes sizing refuse, which is the correct outcome.
 */
export function contractSpecs(): Record<
  string,
  { contractSize: number; base: string; quote: string; lotStep: number; minLot: number }
> {
  const out: Record<
    string,
    { contractSize: number; base: string; quote: string; lotStep: number; minLot: number }
  > = {};
  for (const d of INSTRUMENT_DEFINITIONS) {
    if (d.contractSize === null || d.lotStep === null || d.minLot === null) continue;
    out[d.symbol] = {
      contractSize: d.contractSize,
      base: d.base,
      quote: d.quote,
      lotStep: d.lotStep,
      minLot: d.minLot,
    };
  }
  return out;
}


/** Only symbols with an explicit, validated floor appear here. */
export function spreadFloors(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of INSTRUMENT_DEFINITIONS) {
    if (d.spreadFloor !== null) out[d.symbol] = d.spreadFloor;
  }
  return out;
}
