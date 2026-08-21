import { describe, expect, it } from "vitest";
import { MIN_HEADROOM_ATR, directionalHeadroomAtr, gradeSetup, readTimeframe } from "../grading";
import type { Bias, Candle, TimeframeRead } from "../types";
import { m15Series, rampSeries } from "@/test/fixtures/provenance";

function read(
  timeframe: TimeframeRead["timeframe"],
  bias: Bias,
  overrides: Partial<TimeframeRead> = {},
): TimeframeRead {
  return {
    timeframe,
    bias,
    barrierDistanceAtr: 10,
    barrierPrice: 1.2,
    rangeHigh: 1.2,
    rangeLow: 1.0,
    atr: 0.002,
    atPointC: false,
    ...overrides,
  };
}

describe("gradeSetup — V1 grade boundary characterization", () => {
  it("[V1_CHARACTERIZATION] full alignment + Point C + headroom grades A", () => {
    const g = gradeSetup(
      read("H4", "bullish", { atPointC: true }),
      read("H1", "bullish"),
      read("M15", "bullish", { atPointC: true }),
      5,
    );
    expect(g.grade).toBe("A");
    expect(g.alignmentScore).toBe(98);
  });

  it("[V1_CHARACTERIZATION] H4-neutral with aligned H1+M15 grades B, never C", () => {
    // A neutral H4 is treated as "capped context", not as conflict.
    // CHARACTERISATION.md #5.
    const g = gradeSetup(read("H4", "neutral"), read("H1", "bullish"), read("M15", "bullish"), 20);
    expect(g.grade).toBe("B");
    expect(g.alignmentScore).toBe(74);
  });

  it("[V1_CHARACTERIZATION] H4 OPPOSING an aligned H1+M15 also grades B", () => {
    // Direct higher-timeframe conflict and mere absence of trend produce the
    // same grade in V1. CHARACTERISATION.md #5.
    const g = gradeSetup(read("H4", "bearish"), read("H1", "bullish"), read("M15", "bullish"), 20);
    expect(g.grade).toBe("B");
  });

  it("[V1_CHARACTERIZATION] M15-only bias grades C (mean-reversion fallback)", () => {
    const g = gradeSetup(read("H4", "bearish"), read("H1", "neutral"), read("M15", "bullish"), 20);
    expect(g.grade).toBe("C");
    expect(g.alignmentScore).toBe(45);
  });

  it("[V1_CHARACTERIZATION] a neutral M15 yields no grade at all — the No-Trade default", () => {
    const g = gradeSetup(read("H4", "bullish"), read("H1", "bullish"), read("M15", "neutral"), 20);
    expect(g.grade).toBeNull();
  });

  it("[V1_CHARACTERIZATION] insufficient headroom demotes a fully aligned setup from A to B", () => {
    const aligned = [
      read("H4", "bullish", { atPointC: true }),
      read("H1", "bullish"),
      read("M15", "bullish", { atPointC: true }),
    ] as const;
    expect(gradeSetup(aligned[0], aligned[1], aligned[2], MIN_HEADROOM_ATR).grade).toBe("A");
    expect(gradeSetup(aligned[0], aligned[1], aligned[2], MIN_HEADROOM_ATR - 0.01).grade).toBe("B");
  });

  it("[UNIT] infinite headroom is reported as open space, not as a violation", () => {
    const g = gradeSetup(
      read("H4", "bullish", { atPointC: true }),
      read("H1", "bullish"),
      read("M15", "bullish", { atPointC: true }),
      Number.POSITIVE_INFINITY,
    );
    expect(g.grade).toBe("A");
    expect(g.reasonsViolated).toHaveLength(0);
    expect(g.reasonsSatisfied.some((r) => r.includes("open space"))).toBe(true);
  });

  it("[INVARIANT] alignmentScore always stays within [0,100]", () => {
    const biases: Bias[] = ["bullish", "bearish", "neutral"];
    for (const a of biases)
      for (const b of biases)
        for (const c of biases) {
          const g = gradeSetup(read("H4", a, { atPointC: true }), read("H1", b), read("M15", c), 4);
          expect(g.alignmentScore).toBeGreaterThanOrEqual(0);
          expect(g.alignmentScore).toBeLessThanOrEqual(100);
          expect(Number.isFinite(g.alignmentScore)).toBe(true);
        }
  });
});

describe("directionalHeadroomAtr", () => {
  it("[UNIT] returns 0 when ATR is unavailable", () => {
    expect(
      directionalHeadroomAtr(
        "long",
        rampSeries("2026-08-20T00:00:00.000Z", 30, 1.1, 0.001),
        read("H4", "bullish", { atr: 0 }),
      ),
    ).toBe(0);
  });

  it("[UNIT] a trend with no unbroken opposing pivot ahead reports unbounded headroom", () => {
    const rising = rampSeries("2026-08-20T00:00:00.000Z", 60, 1.1, 0.002);
    const h4 = readTimeframe("H4", rising);
    expect(directionalHeadroomAtr("long", rising, h4)).toBe(Number.POSITIVE_INFINITY);
  });

  it("[UNIT] an unbroken swing high ahead of price is measured in ATR units", () => {
    // Rise to a peak, then pull back. The peak is unbroken resistance.
    const candles: Candle[] = m15Series("2026-08-20T00:00:00.000Z", [
      ...Array.from({ length: 12 }, (_, i) => ({
        open: 100 + i,
        high: 100.5 + i,
        low: 99.5 + i,
        close: 100 + i,
      })),
      ...Array.from({ length: 14 }, (_, i) => ({
        open: 110 - i,
        high: 110.5 - i,
        low: 109.5 - i,
        close: 110 - i,
      })),
    ]);
    const h4 = readTimeframe("H4", candles);
    const headroom = directionalHeadroomAtr("long", candles, h4);
    expect(Number.isFinite(headroom)).toBe(true);
    expect(headroom).toBeGreaterThan(0);
  });
});

describe("readTimeframe", () => {
  it("[V1_CHARACTERIZATION] too few candles produce a neutral read, not a thrown error", () => {
    const r = readTimeframe("H1", rampSeries("2026-08-20T00:00:00.000Z", 5, 1.1, 0.001));
    expect(r.bias).toBe("neutral");
    expect(r.atPointC).toBe(false);
    // atr = 0 on short series, so barrier distance collapses to 0 as well.
    expect(r.atr).toBe(0);
    expect(r.barrierDistanceAtr).toBe(0);
  });

  it("[UNIT] an empty candle array yields a fully neutral, finite read", () => {
    const r = readTimeframe("M15", []);
    expect(r.bias).toBe("neutral");
    expect(r.atr).toBe(0);
    expect(Number.isFinite(r.barrierPrice)).toBe(true);
    expect(Number.isFinite(r.rangeHigh)).toBe(true);
    expect(Number.isFinite(r.rangeLow)).toBe(true);
  });

  it("[UNIT] a sustained uptrend reads bullish with the range high as the barrier", () => {
    const rising = rampSeries("2026-08-20T00:00:00.000Z", 260, 1.1, 0.001);
    const r = readTimeframe("H4", rising);
    expect(r.bias).toBe("bullish");
    expect(r.barrierPrice).toBe(r.rangeHigh);
  });

  it("[UNIT] a sustained downtrend reads bearish with the range low as the barrier", () => {
    const falling = rampSeries("2026-08-20T00:00:00.000Z", 260, 1.4, -0.001);
    const r = readTimeframe("H4", falling);
    expect(r.bias).toBe("bearish");
    expect(r.barrierPrice).toBe(r.rangeLow);
  });
});
