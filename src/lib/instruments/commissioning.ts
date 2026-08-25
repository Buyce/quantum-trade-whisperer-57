/**
 * Commissioning gate — pure decision layer for the
 * `disabled -> data_validation` transition.
 *
 * Readiness (`readiness.server.ts`) answers "can the provider serve this
 * instrument at all". Commissioning answers the narrower operational question:
 * "may this instrument start COLLECTING data today, and if not, exactly what is
 * missing".
 *
 * Two rules make this different from readiness:
 *
 *   1. data_validation is a DATA stage. It does not authorise strategy
 *      evaluation, publication, alerts or execution (see `lifecycle.ts`), so a
 *      conversion route that cannot be verified for every account currency is a
 *      note, not a blocker — nothing here can size or place an order.
 *   2. An UNVERIFIED calendar (every Wave 2 asset class today) may authorise raw
 *      collection, because the provider's own market state and source timestamp
 *      decide whether a tick is usable. It may never authorise a later stage.
 *
 * Nothing in this module fetches, writes, promotes or guesses.
 */
import { assetClassOf, instrumentDefinition } from "./registry";

/** Blockers that keep an instrument at `disabled`. */
export type CommissioningBlocker =
  | "not_in_registry"
  | "no_provider_symbol"
  | "ambiguous_provider_symbol"
  | "not_offered_by_broker"
  | "mapping_unverified"
  | "no_provider_specification"
  | "specification_incomplete"
  | "no_candle_series"
  | "no_live_quote"
  | "breaker_open"
  | "no_capacity_headroom";

/** Notes recorded with the decision but not blocking a DATA-only stage. */
export type CommissioningNote =
  | "calendar_unverified"
  | "conversion_not_verified"
  | "spread_floor_unknown";

export interface CommissioningInput {
  symbol: string;
  /** Provider symbol proven by the mapping authority, null when it refused. */
  providerSymbol: string | null;
  /** Mapping authority status, verbatim. */
  mappingStatus: string | null;
  /** True when a provider specification row exists for this instrument. */
  specPresent: boolean;
  /** Per-field specification presence, as readiness reported it. */
  specFields: Record<string, boolean>;
  /** True when all three timeframes returned a usable series. */
  candlesOk: boolean;
  /** True when a fresh, well-formed quote with a provider timestamp arrived. */
  quoteOk: boolean;
  /** True when every supported account currency verified live. */
  conversionOk: boolean;
  /** Derived stop-floor candidate, null when it could not be measured. */
  spreadFloorCandidate: number | null;
  /** Calendar binding source, null when no binding exists. */
  calendarSource: string | null;
  /** Provider breaker open for this instrument right now. */
  breakerOpen: boolean;
  /** Sampler slots still available after adding this instrument. */
  capacityHeadroom: number;
}

export interface CommissioningDecision {
  symbol: string;
  /** Wave from the frozen registry, null when the symbol is unknown. */
  wave: number | null;
  assetClass: string | null;
  /** True only when every blocker is absent. */
  mayEnterDataValidation: boolean;
  blockers: CommissioningBlocker[];
  notes: CommissioningNote[];
  /** True when the calendar in force for this instrument is broker-verified. */
  calendarVerified: boolean;
  /** One operator-facing sentence. Contains no token, account id or payload. */
  detail: string;
}

/** Specification fields without which there is no honest price grid. */
const REQUIRED_SPEC_FIELDS = ["digits", "point", "contractSize", "minLot", "lotStep"] as const;

const BLOCKER_TEXT: Record<CommissioningBlocker, string> = {
  not_in_registry: "the symbol is not in the instrument registry",
  no_provider_symbol: "no provider symbol has been proven for this instrument",
  ambiguous_provider_symbol:
    "the broker exposes more than one symbol that could be this instrument",
  not_offered_by_broker: "the data provider does not offer this instrument",
  mapping_unverified: "the provider symbol has never been verified, or the check is stale",
  no_provider_specification: "the provider has returned no specification for this instrument",
  specification_incomplete: "the provider specification is missing required numeric fields",
  no_candle_series: "H4, H1 and M15 did not all return a usable series",
  no_live_quote: "no fresh, well-formed quote with a provider timestamp was returned",
  breaker_open: "the per-instrument provider breaker is open",
  no_capacity_headroom: "the sampler has no request headroom left for another instrument",
};

export function evaluateCommissioning(input: CommissioningInput): CommissioningDecision {
  const definition = instrumentDefinition(input.symbol);
  const blockers: CommissioningBlocker[] = [];
  const notes: CommissioningNote[] = [];

  if (!definition) {
    return {
      symbol: input.symbol,
      wave: null,
      assetClass: null,
      mayEnterDataValidation: false,
      blockers: ["not_in_registry"],
      notes: [],
      calendarVerified: false,
      detail: BLOCKER_TEXT.not_in_registry,
    };
  }

  const status = (input.mappingStatus ?? "unverified").toLowerCase();
  if (status === "ambiguous") blockers.push("ambiguous_provider_symbol");
  else if (status === "unavailable") blockers.push("not_offered_by_broker");
  else if (!input.providerSymbol) blockers.push("no_provider_symbol");
  else if (status !== "exact" && status !== "configured") blockers.push("mapping_unverified");

  if (!input.specPresent) blockers.push("no_provider_specification");
  else if (REQUIRED_SPEC_FIELDS.some((f) => !input.specFields[f]))
    blockers.push("specification_incomplete");

  if (!input.candlesOk) blockers.push("no_candle_series");
  if (!input.quoteOk) blockers.push("no_live_quote");
  if (input.breakerOpen) blockers.push("breaker_open");
  if (input.capacityHeadroom <= 0) blockers.push("no_capacity_headroom");

  const calendarVerified = input.calendarSource === "broker_verified";
  if (!calendarVerified) notes.push("calendar_unverified");
  if (!input.conversionOk) notes.push("conversion_not_verified");
  if (input.spreadFloorCandidate === null) notes.push("spread_floor_unknown");

  const may = blockers.length === 0;
  return {
    symbol: definition.symbol,
    wave: definition.wave,
    assetClass: assetClassOf(definition.symbol) ?? null,
    mayEnterDataValidation: may,
    blockers,
    notes,
    calendarVerified,
    detail: may
      ? `${definition.symbol} may start data validation: provider symbol ${input.providerSymbol}, specification present, all three timeframes and a live quote verified.${
          calendarVerified
            ? ""
            : " Its trading calendar is unverified, so collection is authorised by the provider's own market state and source timestamps only — never strategy evaluation, publication or execution."
        }`
      : `${definition.symbol} stays disabled: ${blockers.map((b) => BLOCKER_TEXT[b]).join("; ")}.`,
  };
}

/** Stable operator copy for one blocker. */
export function describeBlocker(blocker: CommissioningBlocker): string {
  return BLOCKER_TEXT[blocker];
}
