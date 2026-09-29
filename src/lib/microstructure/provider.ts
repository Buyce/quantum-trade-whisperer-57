import type { BookSnapshot, MicrostructureProvenance, TradePrint } from "./types";

/**
 * Provider-neutral boundary for exchange data.
 *
 * Adapters must preserve venue timestamps and aggressor-side semantics supplied
 * by the source. They must not infer missing trades, fabricate depth, or replace
 * exchange data with broker tick volume.
 */
export interface MicrostructureProvider {
  readonly id: string;

  getTrades(input: {
    referenceInstrument: string;
    start: string;
    end: string;
  }): Promise<{ provenance: MicrostructureProvenance; trades: TradePrint[] }>;

  getBookSnapshot?(input: {
    referenceInstrument: string;
    at: string;
    depth: number;
  }): Promise<{ provenance: MicrostructureProvenance; book: BookSnapshot }>;
}
