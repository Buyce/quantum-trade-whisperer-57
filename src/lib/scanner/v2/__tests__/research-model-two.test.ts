/**
 * Blocking tests for research model version 2.
 *
 * Classes used here:
 *  [UNIT]      deterministic behaviour of the new pure helpers.
 *  [INVARIANT] model-independent safety properties that must hold for V1 and V2
 *              alike (no NaN/Infinity leakage, probabilities and scores bounded,
 *              stop distance strictly positive, no lookahead).
 *
 * No MetaApi calls, no randomness, no database.
 */
import { describe, expect, it } from "vitest";
import { atr, atrAtIndex } from "../../indicators";
import { rampSeries, m15Series } from "@/test/fixtures/provenance";
import { volatilityScoreV2 } from "../volatility";
import { detectAbcV2, RETRACEMENT_MAX, RETRACEMENT_MIN } from "../pointc";
import { canonicalBarrier, structuralBarrier, OPEN_SPACE_EXTENSION_ATR } from "../barrier";
import { gradeSetupV2 } from "../grading.v2";
import { buildTradeProfileV2 } from "../profile.v2";
import { MODEL_V2_CODE_HASH, MODEL_V2_VERSION, stableHash } from "../manifest";
import type { Candle, PillarScores } from "../../types";

const START = "2026-08-01T00:00:00.000Z";

/**
 * Deterministic zig-zag builder with provenance: synthetic, no randomness, no
 * network. Warm-up ramp -> dip (pivot A) -> impulse (pivot B) -> retracement (C).
 */
function abcSeries(direction: "long" | "short", retrace: number): Candle[] {
  const legs: Array<{ open: number; high: number; low: number; close: number }> = [];
  const push = (c: number, w = 0.05) => legs.push({ open: c, high: c + w, low: c - w, close: c });
  const s = direction === "long" ? 1 : -1;
  let px = 100;
  for (let i = 0; i < 200; i += 1) {
    px += s * 0.05;
    push(px);
  }
  for (let i = 0; i < 6; i += 1) {
    px -= s * 0.5;
    push(px);
  }
  const a = px - s * 0.05;
  for (let i = 0; i < 12; i += 1) {
    px += s * 1.0;
    push(px);
  }
  const b = px + s * 0.05;
  const amplitude = Math.abs(b - a);
  const cTarget = b - s * amplitude * retrace;
  for (let i = 1; i <= 6; i += 1) push(b + ((cTarget - b) * i) / 6);
  return m15Series(START, legs);
}

describe("atrAtIndex (Wilder, prefix-only)", () => {
  const series = rampSeries(START, 80, 1.1, 0.0007);

  it("[UNIT] at the last index it equals atr() over the whole series", () => {
    const last = atrAtIndex(series, series.length - 1, 14);
    expect(last).not.toBeNull();
    expect(last as number).toBeCloseTo(atr(series, 14), 12);
  });

  it("[INVARIANT] is prefix-invariant: appending future candles cannot change it", () => {
    const i = 40;
    const before = atrAtIndex(series, i, 14);
    const extended = [...series, ...rampSeries(START, 20, 9, 0.5)];
    expect(atrAtIndex(extended, i, 14)).toBe(before);
  });

  it("[UNIT] equals atr() evaluated on the same prefix, for every measurable index", () => {
    for (let i = 14; i < series.length; i += 7) {
      const prefix = series.slice(0, i + 1);
      expect(atrAtIndex(series, i, 14) as number).toBeCloseTo(atr(prefix, 14), 12);
    }
  });

  it("[INVARIANT] fails closed with null instead of reporting zero volatility", () => {
    expect(atrAtIndex(series, 5, 14)).toBeNull();
    expect(atrAtIndex(series, -1, 14)).toBeNull();
    expect(atrAtIndex(series, 999, 14)).toBeNull();
    const broken = series.map((c, i) => (i === 3 ? { ...c, high: Number.NaN } : c));
    expect(atrAtIndex(broken, 40, 14)).toBeNull();
  });
});

describe("V2 volatility transform", () => {
  it("[UNIT] is continuous at the pass boundary, unlike the V1 step function", () => {
    expect(volatilityScoreV2(0.999)).toBeCloseTo(59.94, 2);
    expect(volatilityScoreV2(1)).toBe(60);
    expect(volatilityScoreV2(1.001)).toBeGreaterThan(60);
    expect(volatilityScoreV2(1.001) - volatilityScoreV2(0.999)).toBeLessThan(0.2);
  });

  it("[INVARIANT] is monotone non-decreasing and bounded to [0, 100]", () => {
    let prev = -1;
    for (let r = 0; r <= 3; r += 0.01) {
      const v = volatilityScoreV2(r);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
  });

  it("[INVARIANT] non-finite or non-positive input scores zero, never NaN", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY * 0, -1, 0]) {
      expect(volatilityScoreV2(bad)).toBe(0);
    }
    // Infinity is not a measurement either: it fails closed rather than saturating.
    expect(volatilityScoreV2(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("V2 canonical Point C", () => {
  it("[UNIT] accepts a retracement inside the band and reports it", () => {
    const abc = detectAbcV2(abcSeries("long", 0.6), "long");
    expect(abc).not.toBeNull();
    const a = abc as NonNullable<typeof abc>;
    expect(a.retracement).toBeGreaterThanOrEqual(RETRACEMENT_MIN);
    expect(a.retracement).toBeLessThanOrEqual(RETRACEMENT_MAX);
  });

  it("[UNIT] rejects a shallow retracement below the band", () => {
    expect(detectAbcV2(abcSeries("long", 0.1), "long")).toBeNull();
  });

  it("[UNIT] rejects a retracement deeper than the band", () => {
    expect(detectAbcV2(abcSeries("long", 0.99), "long")).toBeNull();
  });

  it("[INVARIANT] A/B chronology holds and C is strictly between A and B", () => {
    for (const dir of ["long", "short"] as const) {
      const abc = detectAbcV2(abcSeries(dir, 0.55), dir);
      if (!abc) continue;
      expect(abc.aIndex).toBeLessThan(abc.bIndex);
      expect(abc.cIndex).toBeGreaterThan(abc.bIndex);
      const lo = Math.min(abc.a, abc.b);
      const hi = Math.max(abc.a, abc.b);
      expect(abc.c).toBeGreaterThan(lo);
      expect(abc.c).toBeLessThan(hi);
      expect(Number.isFinite(abc.retracement)).toBe(true);
    }
  });

  it("[INVARIANT] never returns a structure on degenerate or non-finite input", () => {
    expect(detectAbcV2([], "long")).toBeNull();
    const broken = abcSeries("long", 0.55).map((c, i) => (i === 2 ? { ...c, low: Number.NaN } : c));
    expect(detectAbcV2(broken, "long")).toBeNull();
  });
});

describe("V2 canonical barrier", () => {
  const h4 = rampSeries(START, 120, 1900, 0.6);

  it("[UNIT] open space yields a finite ATR extension anchored on the entry", () => {
    const a = atr(h4, 14);
    const entry = (h4[h4.length - 1] as Candle).close;
    expect(structuralBarrier("long", h4, a, entry)).toBeNull();
    const b = canonicalBarrier({
      direction: "long",
      h4Candles: h4,
      h4Atr: a,
      reference: entry,
      anchor: entry,
    });
    expect(b?.source).toBe("open_space_extension");
    expect(b?.headroomAtr).toBe(OPEN_SPACE_EXTENSION_ATR);
    expect(Number.isFinite(b?.price as number)).toBe(true);
  });

  it("[INVARIANT] headroom is finite whenever ATR is measurable — never Infinity", () => {
    for (const dir of ["long", "short"] as const) {
      const b = canonicalBarrier({
        direction: dir,
        h4Candles: h4,
        h4Atr: atr(h4, 14),
        reference: (h4[h4.length - 1] as Candle).close,
        anchor: (h4[h4.length - 1] as Candle).close,
      });
      expect(b).not.toBeNull();
      expect(Number.isFinite((b as NonNullable<typeof b>).headroomAtr)).toBe(true);
    }
  });

  it("[INVARIANT] a zero or non-finite ATR is not measurable and returns null", () => {
    const ref = (h4[h4.length - 1] as Candle).close;
    expect(canonicalBarrier({ direction: "long", h4Candles: h4, h4Atr: 0, reference: ref, anchor: ref })).toBeNull();
    expect(
      canonicalBarrier({ direction: "long", h4Candles: h4, h4Atr: Number.NaN, reference: ref, anchor: ref }),
    ).toBeNull();
  });
});

describe("V2 grade truth table", () => {
  const pillars = (passed: number): PillarScores => ({
    trend: 80,
    orderBlock: 80,
    momentum: 80,
    volatilityExpansion: 80,
    passed,
    notes: [],
  });

  it("[UNIT] all aligned, clear headroom and four pillars grades A+", () => {
    const r = gradeSetupV2({
      h4Bias: "bullish",
      h1Bias: "bullish",
      m15Bias: "bullish",
      headroomAtr: 4,
      inRetracementBand: true,
      pillars: pillars(4),
    });
    expect(r).toMatchObject({ family: "continuation", grade: "A+" });
  });

  it("[UNIT] the same structure with three pillars grades A, not A+", () => {
    expect(
      gradeSetupV2({
        h4Bias: "bullish",
        h1Bias: "bullish",
        m15Bias: "bullish",
        headroomAtr: 4,
        inRetracementBand: true,
        pillars: pillars(3),
      }).grade,
    ).toBe("A");
  });

  it("[UNIT] H4 disagreement or exhausted headroom grades B and says which", () => {
    const noH4 = gradeSetupV2({
      h4Bias: "bearish",
      h1Bias: "bullish",
      m15Bias: "bullish",
      headroomAtr: 4,
      inRetracementBand: true,
      pillars: pillars(4),
    });
    expect(noH4.grade).toBe("B");
    expect(noH4.reasons.join(" ")).toContain("H4 does not agree");

    const jammed = gradeSetupV2({
      h4Bias: "bullish",
      h1Bias: "bullish",
      m15Bias: "bullish",
      headroomAtr: 0.4,
      inRetracementBand: true,
      pillars: pillars(4),
    });
    expect(jammed.grade).toBe("B");
    expect(jammed.reasons.join(" ")).toContain("Headroom only");
  });

  it("[UNIT] M15 opposing H1 is the mean-reversion family, graded C", () => {
    const r = gradeSetupV2({
      h4Bias: "bullish",
      h1Bias: "bullish",
      m15Bias: "bearish",
      headroomAtr: 4,
      inRetracementBand: true,
      pillars: pillars(0),
    });
    expect(r).toMatchObject({ family: "mean_reversion", grade: "C" });
  });

  it("[INVARIANT] a neutral M15 read never produces a grade", () => {
    expect(
      gradeSetupV2({
        h4Bias: "bullish",
        h1Bias: "bullish",
        m15Bias: "neutral",
        headroomAtr: 4,
        inRetracementBand: true,
        pillars: pillars(4),
      }),
    ).toMatchObject({ family: null, grade: null });
  });
});

describe("buildTradeProfileV2", () => {
  const candlesFor = (direction: "long" | "short") => ({
    M15: abcSeries(direction, 0.55),
    H1: rampSeries(START, 300, 100, direction === "long" ? 0.05 : -0.05),
    H4: rampSeries(START, 300, 100, direction === "long" ? 0.12 : -0.12),
  });

  it("[INVARIANT] every returned evaluation is a plain, serialisable DTO", () => {
    for (const dir of ["long", "short"] as const) {
      const ev = buildTradeProfileV2({ instrument: "EURUSD", candles: candlesFor(dir) });
      expect(ev.modelVersion).toBe(MODEL_V2_VERSION);
      expect(["candidate", "no_trade"]).toContain(ev.decision);
      expect(typeof ev.reason).toBe("string");
      expect(() => JSON.stringify(ev)).not.toThrow();
    }
  });

  it("[INVARIANT] a candidate never leaks NaN or Infinity and keeps risk strictly positive", () => {
    for (const dir of ["long", "short"] as const) {
      const ev = buildTradeProfileV2({ instrument: "XAUUSD", candles: candlesFor(dir) });
      if (ev.decision !== "candidate" || !ev.profile) continue;
      const p = ev.profile;
      const numbers = [
        p.entryPrice,
        p.stopLoss,
        p.tp1,
        p.tp2,
        p.tp1R,
        p.tp2R,
        p.maxR,
        p.rrRatio,
        p.atr,
        p.retracement,
        p.headroomAtr,
        p.maxAcceptableEntry,
        ...(p.tp3 === null ? [] : [p.tp3]),
        ...(p.tp3R === null ? [] : [p.tp3R]),
      ];
      for (const n of numbers) expect(Number.isFinite(n)).toBe(true);
      expect(Math.abs(p.entryPrice - p.stopLoss)).toBeGreaterThan(0);
      expect(p.maxR).toBeGreaterThanOrEqual(1);
      for (const score of [p.pTrend, p.pOrderBlock, p.pMomentum, p.pVolatilityExpansion]) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
      // Targets sit the correct side of the entry for the traded direction.
      const sign = p.direction === "long" ? 1 : -1;
      expect((p.tp1 - p.entryPrice) * sign).toBeGreaterThan(0);
      expect((p.stopLoss - p.entryPrice) * sign).toBeLessThan(0);
    }
  });

  it("[INVARIANT] is deterministic: the same snapshot yields the same evaluation", () => {
    const candles = candlesFor("long");
    const a = buildTradeProfileV2({ instrument: "EURUSD", candles });
    const b = buildTradeProfileV2({ instrument: "EURUSD", candles });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("model v2 manifest", () => {
  it("[UNIT] the code hash is a stable digest of the canonical parameter set", () => {
    expect(MODEL_V2_CODE_HASH).toMatch(/^[0-9a-f]{16}$/);
    expect(stableHash({ a: 1, b: 2 })).toBe(stableHash({ b: 2, a: 1 }));
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
  });
});
