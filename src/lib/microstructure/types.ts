/**
 * Exchange microstructure contracts.
 *
 * This module is research-only. Nothing here is execution-eligible and no
 * consumer may use these records to submit, resize, cancel or modify orders.
 */

export type AggressorSide = "buy" | "sell" | "unknown";

export interface TradePrint {
  eventTime: string;
  price: number;
  size: number;
  aggressorSide: AggressorSide;
  sequence?: number | null;
}

export interface DepthLevel {
  price: number;
  size: number;
  orderCount?: number | null;
}

export interface BookSnapshot {
  eventTime: string;
  bids: DepthLevel[];
  asks: DepthLevel[];
}

export interface MicrostructureProvenance {
  provider: string;
  dataset: string;
  venue: string;
  referenceInstrument: string;
  canonicalInstrument: string;
  schema: "trades" | "mbp" | "mbo";
  asOf: string;
  windowStart: string;
  windowEnd: string;
}

export interface VolumeProfileLevel {
  price: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
}

export interface VolumeProfile {
  tickSize: number;
  poc: number | null;
  valueAreaLow: number | null;
  valueAreaHigh: number | null;
  totalVolume: number;
  levels: VolumeProfileLevel[];
}

export interface TradeFlowFeatures {
  tradeCount: number;
  totalVolume: number;
  buyVolume: number;
  sellVolume: number;
  unknownVolume: number;
  delta: number;
  deltaRatio: number | null;
  firstPrice: number | null;
  lastPrice: number | null;
  priceChange: number | null;
  volumeProfile: VolumeProfile;
}

export interface MicrostructureSnapshot {
  version: 1;
  mode: "shadow";
  executionEligible: false;
  provenance: MicrostructureProvenance;
  tradeFlow: TradeFlowFeatures;
}
