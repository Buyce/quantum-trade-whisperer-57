/**
 * Fixture provenance contract.
 *
 * Every committed market fixture MUST declare where it came from and which
 * known defects it intentionally represents. A fixture without provenance is
 * rejected by `src/test/__tests__/fixture-provenance.test.ts`.
 *
 * No fixture in this repository may be produced by calling MetaApi or any
 * broker endpoint: `sourceType` is limited to synthetic construction or data
 * already stored in the project.
 */
import type { Candle } from "@/lib/scanner/types";

export const FIXTURE_SCHEMA_VERSION = 1 as const;

export type FixtureSourceType = "synthetic" | "captured-existing-data";

export interface FixtureProvenance {
  instrument: string;
  timeframe: "H4" | "H1" | "M15";
  /** ISO timestamps of the first and last candle in the fixture. */
  candleRange: { from: string; to: string };
  /** Model version whose behaviour this fixture characterises. */
  modelVersion: number;
  fixtureSchemaVersion: typeof FIXTURE_SCHEMA_VERSION;
  sourceType: FixtureSourceType;
  /** Defects deliberately represented, keyed to CHARACTERISATION.md. */
  knownDefects: string[];
  /** Asserted at author time and re-checked by the provenance test. */
  containsNoSecrets: true;
}

export interface MarketFixture {
  id: string;
  provenance: FixtureProvenance;
  candles: Candle[];
}

/** Deterministic synthetic M15 series. No randomness, no network. */
export function m15Series(
  startIso: string,
  bars: Array<{ open: number; high: number; low: number; close: number }>,
): Candle[] {
  const start = new Date(startIso).getTime();
  return bars.map((b, i) => ({
    time: new Date(start + i * 15 * 60_000).toISOString(),
    ...b,
  }));
}

/** A flat-then-drifting synthetic series builder used by indicator fixtures. */
export function rampSeries(startIso: string, count: number, from: number, step: number): Candle[] {
  return m15Series(
    startIso,
    Array.from({ length: count }, (_, i) => {
      const close = from + i * step;
      return { open: close - step / 2, high: close + step, low: close - step, close };
    }),
  );
}

export function defineFixture(fixture: MarketFixture): MarketFixture {
  return fixture;
}
