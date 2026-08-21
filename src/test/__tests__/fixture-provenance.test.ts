import { describe, expect, it } from "vitest";
import { FIXTURE_SCHEMA_VERSION, type MarketFixture } from "../fixtures/provenance";
import { ALL_REPLAY_FIXTURES } from "../fixtures/replay-fixtures";

const ALL_FIXTURES: MarketFixture[] = [...ALL_REPLAY_FIXTURES];

describe("fixture provenance contract", () => {
  it("[INVARIANT] at least one fixture is registered, so this gate can never pass vacuously", () => {
    expect(ALL_FIXTURES.length).toBeGreaterThan(0);
  });

  it.each(ALL_FIXTURES.map((f) => [f.id, f] as const))(
    "[INVARIANT] %s declares complete provenance and no live-broker origin",
    (_id, fixture) => {
      const p = fixture.provenance;
      expect(p.instrument).toMatch(/^[A-Z]{6}$/);
      expect(["H4", "H1", "M15"]).toContain(p.timeframe);
      expect(p.modelVersion).toBe(1);
      expect(p.fixtureSchemaVersion).toBe(FIXTURE_SCHEMA_VERSION);
      // Zero MetaApi calls: fixtures are synthetic or already-stored data only.
      expect(["synthetic", "captured-existing-data"]).toContain(p.sourceType);
      expect(Array.isArray(p.knownDefects)).toBe(true);
      expect(p.containsNoSecrets).toBe(true);
      expect(Number.isFinite(new Date(p.candleRange.from).getTime())).toBe(true);
      expect(Number.isFinite(new Date(p.candleRange.to).getTime())).toBe(true);
    },
  );

  it.each(ALL_FIXTURES.map((f) => [f.id, f] as const))(
    "[INVARIANT] %s candles are well-formed OHLC in ascending time order",
    (_id, fixture) => {
      expect(fixture.candles.length).toBeGreaterThan(0);
      let previous = -Infinity;
      for (const c of fixture.candles) {
        const t = new Date(c.time).getTime();
        expect(Number.isFinite(t)).toBe(true);
        expect(t).toBeGreaterThan(previous);
        previous = t;
        for (const v of [c.open, c.high, c.low, c.close]) expect(Number.isFinite(v)).toBe(true);
        expect(c.high).toBeGreaterThanOrEqual(c.low);
        expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
        expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
      }
    },
  );

  it.each(ALL_FIXTURES.map((f) => [f.id, f] as const))(
    "[INVARIANT] %s declared candle range matches its actual first/last candle",
    (_id, fixture) => {
      expect(fixture.candles[0]!.time).toBe(fixture.provenance.candleRange.from);
      expect(fixture.candles[fixture.candles.length - 1]!.time).toBe(
        fixture.provenance.candleRange.to,
      );
    },
  );
});
