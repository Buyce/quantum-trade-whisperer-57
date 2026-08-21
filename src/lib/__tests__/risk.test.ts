import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { CONTRACT_SPECS, DEFAULT_RISK_PROFILE, calculateRisk, type RiskProfile } from "../risk";

const SEED = 20_260_821;

function profile(overrides: Partial<RiskProfile> = {}): RiskProfile {
  return { ...DEFAULT_RISK_PROFILE, accountEquity: 10_000, riskPerTradePercent: 1, ...overrides };
}

describe("calculateRisk — fail-closed behaviour", () => {
  it("[INVARIANT] no account equity returns an explicit reason, never a lot size", () => {
    const out = calculateRisk({
      instrument: "EURUSD",
      entry: 1.1,
      stopLoss: 1.095,
      profile: profile({ accountEquity: 0 }),
      rates: {},
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("no_equity");
  });

  it("[INVARIANT] an unknown instrument fails closed with no_spec", () => {
    const out = calculateRisk({
      instrument: "NOTAPAIR",
      entry: 1.1,
      stopLoss: 1.095,
      profile: profile(),
      rates: {},
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("no_spec");
  });

  it("[INVARIANT] a zero or non-finite stop distance fails closed instead of dividing by zero", () => {
    for (const stopLoss of [1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = calculateRisk({
        instrument: "EURUSD",
        entry: 1.1,
        stopLoss,
        profile: profile(),
        rates: {},
      });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.reason).toBe("invalid_stop");
    }
  });

  it("[INVARIANT] a cross pair without a conversion rate refuses to size", () => {
    const out = calculateRisk({
      instrument: "GBPAUD",
      entry: 1.95,
      stopLoss: 1.94,
      profile: profile({ accountCurrency: "USD" }),
      rates: {},
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("no_conversion_rate");
  });

  it("[UNIT] a textbook EURUSD trade sizes to the documented lot count", () => {
    // 1% of 10,000 = $100 risk; 50 pip stop on 100k contract = $500/lot → 0.20 lots.
    const out = calculateRisk({
      instrument: "EURUSD",
      entry: 1.1,
      stopLoss: 1.095,
      profile: profile(),
      rates: {},
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.lots).toBeCloseTo(0.2, 10);
    expect(out.riskAmount).toBeCloseTo(100, 6);
    expect(out.belowMinimumLot).toBe(false);
  });

  it("[UNIT] the hard lot ceiling caps the size and is reported", () => {
    const out = calculateRisk({
      instrument: "EURUSD",
      entry: 1.1,
      stopLoss: 1.095,
      profile: profile({ maxPositionSize: 0.05 }),
      rates: {},
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.lots).toBeCloseTo(0.05, 10);
    expect(out.riskAmount).toBeLessThanOrEqual(100 + 1e-9);
  });

  it("[UNIT] a stop wider than maxStopLossPercent is flagged, not silently sized", () => {
    const out = calculateRisk({
      instrument: "EURUSD",
      entry: 1.1,
      stopLoss: 1.0,
      profile: profile({ maxStopLossPercent: 1 }),
      rates: {},
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.exceedsStopCeiling).toBe(true);
  });
});

describe("calculateRisk — position-size invariants (property, fixed seed)", () => {
  it("[INVARIANT] realised risk never exceeds the risk budget and every output is finite", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.keys(CONTRACT_SPECS)),
        fc.double({ min: 100, max: 5_000_000, noNaN: true }),
        fc.double({ min: 0.05, max: 10, noNaN: true }),
        fc.double({ min: 0.5, max: 3000, noNaN: true }),
        fc.double({ min: 0.0001, max: 0.05, noNaN: true }),
        fc.constantFrom<"long" | "short">("long", "short"),
        (instrument, accountEquity, riskPerTradePercent, entry, stopFraction, side) => {
          const stopDistance = Math.max(entry * stopFraction, 1e-6);
          const stopLoss = side === "long" ? entry - stopDistance : entry + stopDistance;
          if (stopLoss <= 0) return true;
          const out = calculateRisk({
            instrument,
            entry,
            stopLoss,
            profile: profile({ accountEquity, riskPerTradePercent, accountCurrency: "USD" }),
            rates: { AUDUSD: 0.66, GBPUSD: 1.27 },
          });
          if (!out.ok) return true;
          const budget = accountEquity * (riskPerTradePercent / 100);
          expect(out.riskAmount).toBeLessThanOrEqual(budget * (1 + 1e-9) + 1e-9);
          expect(out.riskBudget).toBeCloseTo(budget, 6);
          expect(out.lots).toBeGreaterThanOrEqual(0);
          for (const v of [out.lots, out.riskAmount, out.notional, out.marginRequired]) {
            expect(Number.isFinite(v)).toBe(true);
          }
          // Lots must land on the broker's lot step — never a fractional remainder.
          const step = CONTRACT_SPECS[instrument]!.lotStep;
          expect(Math.abs(out.lots / step - Math.round(out.lots / step))).toBeLessThan(1e-6);
          return true;
        },
      ),
      { seed: SEED, numRuns: 300 },
    );
  });
});
