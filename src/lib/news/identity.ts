/**
 * Event identity, checksums and instrument mapping.
 *
 * Identity is derived from a provider's stable ids, never from a title: a provider
 * that renames "CPI" to "Consumer Price Index" must not create a second event.
 */
import { createHash } from "node:crypto";

import { correlationGroupOf } from "@/lib/instruments/correlation";
import { newsFamiliesOf } from "@/lib/instruments/news-risk";
import { INSTRUMENT_DEFINITIONS } from "@/lib/instruments/registry";

import type { NewsFamily, NormalizedEvent } from "./types";

/** Bumped whenever the identity or normalisation rules change. */
export const IDENTITY_VERSION = "news-identity-1";

export function providerEventKey(parts: (string | number)[]): string {
  return parts.map((p) => String(p).trim()).join(":");
}

/**
 * Canonical identity for the same real-world release across providers.
 *
 * `scope` is a currency or country, `slug` an event slug from the versioned map,
 * `period` the release/observation period the event refers to.
 */
export function canonicalEventId(input: { scope: string; slug: string; period: string }): string {
  return `${input.scope.toLowerCase()}:${input.slug}:${input.period}`;
}

/**
 * Checksum over the facts we persist.
 *
 * Deliberately excludes ingestion time so that re-fetching an unchanged event is a
 * duplicate rather than a revision.
 */
export function eventChecksum(event: NormalizedEvent): string {
  const material = JSON.stringify([
    event.providerEventKey,
    event.canonicalEventId,
    event.family,
    event.currencies,
    event.importance,
    event.scheduledAt,
    event.scheduledDate,
    event.actualPublishedAt ?? null,
    event.timestampPrecision,
    event.status,
    event.actual,
    event.forecast,
    event.previous,
    event.units,
    event.providerUpdatedAt,
  ]);
  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}

/** Currencies an instrument is structurally exposed to. */
export function currenciesOfInstrument(symbol: string): string[] {
  const def = INSTRUMENT_DEFINITIONS.find((d) => d.symbol === symbol);
  if (!def) return [];
  const out = new Set<string>();
  // A metal/energy/index quoted in USD carries USD macro risk; the "base" of
  // XAUUSD is not a currency whose calendar we can watch.
  if (def.assetClass === "fx") out.add(def.base);
  out.add(def.quote);
  return [...out];
}

/** Instruments affected by an event, from its currencies AND its family. */
export function instrumentsForEvent(input: { family: NewsFamily; currencies: string[] }): string[] {
  const currencies = new Set(input.currencies.map((c) => c.toUpperCase()));
  return INSTRUMENT_DEFINITIONS.filter((def) => {
    if (!newsFamiliesOf(def.symbol).includes(input.family)) return false;
    const exposure = currenciesOfInstrument(def.symbol);
    // Energy/OPEC families are instrument-driven rather than currency-driven.
    if (input.family === "energy_inventory" || input.family === "opec_supply") {
      return def.assetClass === "energy";
    }
    return exposure.some((c) => currencies.has(c));
  }).map((def) => def.symbol);
}

export function correlationGroupsFor(symbols: string[]): string[] {
  return [...new Set(symbols.map((s) => correlationGroupOf(s)))];
}

/** Required news coverage for an instrument: which currencies × which families. */
export function requiredCoverageFor(symbol: string): {
  currencies: string[];
  families: NewsFamily[];
} {
  const families = newsFamiliesOf(symbol);
  const currencies = currenciesOfInstrument(symbol);
  return { currencies, families };
}
