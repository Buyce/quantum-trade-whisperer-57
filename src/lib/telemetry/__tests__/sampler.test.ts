import { describe, expect, it } from "vitest";

import {
  MAX_INSTRUMENTS_PER_RUN,
  MAX_REQUESTS_PER_RUN,
  SAMPLER_INTERVAL_MS,
  SAMPLER_VERSION,
  alignSlot,
  classifyQuote,
  dailyRequestBudget,
  spreadMetrics,
} from "../sampler";

const NOW = new Date("2026-08-26T10:07:31.000Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

describe("spread sample classification", () => {
  it("[UNIT] accepts a fresh, well-formed, positive-spread quote", () => {
    const result = classifyQuote({
      bid: 1.1,
      ask: 1.1002,
      sourceTime: at(-5_000),
      now: NOW,
      marketClosed: false,
    });
    expect(result).toEqual({ quality: "valid", reasons: [], marketState: "open" });
  });

  it("[INVARIANT] a closed market yields a classified attempt, never a measurement", () => {
    const result = classifyQuote({
      bid: 1.1,
      ask: 1.1002,
      sourceTime: at(-5_000),
      now: NOW,
      marketClosed: true,
    });
    expect(result.quality).toBe("closed_market");
    expect(result.marketState).toBe("closed");
  });

  it("[INVARIANT] refuses crossed, zero-spread, nonfinite and undated quotes", () => {
    const base = { now: NOW, marketClosed: false, sourceTime: at(-1_000) };
    expect(classifyQuote({ ...base, bid: 1.2, ask: 1.1 }).quality).toBe("inverted");
    expect(classifyQuote({ ...base, bid: 1.1, ask: 1.1 }).quality).toBe("malformed");
    expect(classifyQuote({ ...base, bid: 0, ask: 1.1 }).quality).toBe("malformed");
    expect(classifyQuote({ ...base, bid: 1.1, ask: Number.NaN }).quality).toBe("malformed");
    expect(
      classifyQuote({ now: NOW, marketClosed: false, sourceTime: null, bid: 1.1, ask: 1.2 })
        .quality,
    ).toBe("malformed");
  });

  it("[INVARIANT] separates stale from future-dated broker timestamps", () => {
    const base = { bid: 1.1, ask: 1.1002, now: NOW, marketClosed: false };
    expect(classifyQuote({ ...base, sourceTime: at(-121_000) }).quality).toBe("stale");
    expect(classifyQuote({ ...base, sourceTime: at(60_000) }).quality).toBe("future_dated");
    // Small broker clock lead is tolerated rather than discarded.
    expect(classifyQuote({ ...base, sourceTime: at(10_000) }).quality).toBe("valid");
  });
});

describe("spread metrics", () => {
  it("[UNIT] converts to points and pips only when the broker unit is known", () => {
    const known = spreadMetrics({ bid: 1.1, ask: 1.1002, point: 0.00001, digits: 5, atr: 0.001 });
    expect(known.spreadPrice).toBeCloseTo(0.0002, 10);
    expect(known.spreadPoints).toBeCloseTo(20, 6);
    expect(known.spreadPips).toBeCloseTo(2, 6);
    expect(known.spreadAtrFraction).toBeCloseTo(0.2, 6);

    const unknown = spreadMetrics({ bid: 1.1, ask: 1.1002, point: null, digits: null, atr: null });
    expect(unknown.spreadPoints).toBeNull();
    expect(unknown.spreadPips).toBeNull();
    expect(unknown.spreadAtrFraction).toBeNull();
  });

  it("[INVARIANT] a 3-digit JPY-style quote uses a ten-point pip", () => {
    const jpy = spreadMetrics({ bid: 147.1, ask: 147.118, point: 0.001, digits: 3, atr: null });
    expect(jpy.spreadPoints).toBeCloseTo(18, 4);
    expect(jpy.spreadPips).toBeCloseTo(1.8, 4);
  });

  it("[INVARIANT] a zero or absent ATR never produces a fabricated fraction", () => {
    expect(
      spreadMetrics({ bid: 1.1, ask: 1.1002, point: 0.00001, digits: 5, atr: 0 }).spreadAtrFraction,
    ).toBeNull();
  });
});

describe("sampler budget", () => {
  it("[INVARIANT] slots align to the 15-minute cadence, flooring the instant", () => {
    expect(alignSlot(NOW).toISOString()).toBe("2026-08-26T10:00:00.000Z");
    expect(alignSlot(new Date("2026-08-26T10:59:59.999Z")).toISOString()).toBe(
      "2026-08-26T10:45:00.000Z",
    );
  });

  it("[INVARIANT] Wave 0 sampling costs exactly 288 instrument-slots per day", () => {
    const budget = dailyRequestBudget(3, SAMPLER_INTERVAL_MS);
    expect(budget.slotsPerDay).toBe(96);
    expect(budget.instrumentSlotsPerDay).toBe(288);
    expect(budget.requestsPerDay).toBe(288);
  });

  it("[INVARIANT] compiled ceilings stay at the reviewed Wave 0 values", () => {
    expect(MAX_INSTRUMENTS_PER_RUN).toBe(3);
    expect(MAX_REQUESTS_PER_RUN).toBe(6);
    expect(SAMPLER_VERSION).toBe(1);
  });
});
