import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  CONTRACT_SPECS,
  DEFAULT_RISK_PROFILE,
  calculateRisk,
  conversionRate,
  type RiskProfile,
} from "../risk";

/** Fixed seed: property failures must be reproducible for any reviewer. */
const SEED = 20_260_821;

function profile(overrides: Partial<RiskProfile> = {}): RiskProfile {
  return { ...DEFAULT_RISK_PROFILE, accountEquity: 10_000, riskPerTradePercent: 1, ...overrides };
}

describe("conversionRate", () => {
  it("[UNIT] same currency is parity, direct and inverse pairs both resolve", () => {
    expect(conversionRate("USD", "USD", {})).toBe(1);
    expect(conversionRate("AUD", "USD", { AUDUSD: 0.66 })).toBeCloseTo(0.66, 12);
    expect(conversionRate("USD", "AUD", { AUDUSD: 0.66 })).toBeCloseTo(1 / 0.66, 12);
  });

  it("[INVARIANT] a missing or non-positive rate returns null, never an assumed parity", () => {
    expect(conversionRate("AUD", "USD", {})).toBeNull();
    expect(conversionRate("AUD", "USD", { AUDUSD: 0 })).toBeNull();
    expect(conversionRate("AUD", "USD", { AUDUSD: Number.NaN })).toBeNull();
  });
});

describe("calculateRisk — fail-closed behaviour", () => {
  it("[INVARIANT] no account equity returns an explicit reason, never a lot size", () => {
    const out = calculateRisk(
      { instrument: "EURUSD", entryPrice: 1.1, stopLoss: 1.095 },
      profile({ accountEquity: 0 }),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("no_equity");
  });

  it("[INVARIANT] an unknown instrument fails closed with no_spec", () => {
    const out = calculateRisk({ instrument: "NOTAPAIR", entryPrice: 1.1, stopLoss: 1.095 }, profile());
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("no_spec");
  });

  it("[INVARIANT] a zero or non-finite stop distance fails closed instead of dividing by zero", () => {
    for (const stopLoss of [1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = calculateRisk({ instrument: "EURUSD", entryPrice: 1.1, stopLoss }, profile());
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.reason).toBe("invalid_stop");
    }
  });

  it("[INVARIANT] a cross pair without a conversion rate refuses to size", () => {
    const out = calculateRisk(
      { instrument: "GBPAUD", entryPrice: 1.95, stopLoss: 1.94 },
      profile({ accountCurrency: "USD" }),
      {},
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("no_conversion_rate");
  });

  it("[UNIT] a textbook EURUSD trade sizes to the documented lot count", () => {
    // 1% of 10,000 = $100 risk; 0.0050 stop x 100k contract = $500/lot → 0.20 lots.
    const out = calculateRisk({ instrument: "EURUSD", entryPrice: 1.1, stopLoss: 1.095 }, profile());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.lots).toBeCloseTo(0.2, 10);
    expect(out.riskAmount).toBeCloseTo(100, 6);
    expect(out.riskPercentOfEquity).toBeCloseTo(1, 6);
    expect(out.belowMinimumLot).toBe(false);
    expect(out.cappedByPositionSize).toBe(false);
  });

  it("[UNIT] gold uses the 100oz contract size", () => {
    // 1% of 10,000 = $100; $10 stop x 100oz = $1000/lot → 0.10 lots.
    const out = calculateRisk({ instrument: "XAUUSD", entryPrice: 2400, stopLoss: 2390 }, profile());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.lots).toBeCloseTo(0.1, 10);
  });

  it("[UNIT] the hard lot ceiling caps the size and is reported", () => {
    const out = calculateRisk(
      { instrument: "EURUSD", entryPrice: 1.1, stopLoss: 1.095 },
      profile({ maxPositionSize: 0.05 }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.lots).toBeCloseTo(0.05, 10);
    expect(out.cappedByPositionSize).toBe(true);
    expect(out.riskAmount).toBeLessThanOrEqual(out.riskBudget + 1e-9);
  });

  it("[UNIT] a stop wider than the configured ceiling is flagged, not silently sized", () => {
    const out = calculateRisk(
      { instrument: "EURUSD", entryPrice: 1.1, stopLoss: 1.0 },
      profile({ maxStopLossPercent: 1 }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.exceedsStopCeiling).toBe(true);
  });

  it("[UNIT] rounding down means a tiny account is flagged below the minimum lot", () => {
    const out = calculateRisk(
      { instrument: "EURUSD", entryPrice: 1.1, stopLoss: 1.095 },
      profile({ accountEquity: 100 }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.lots).toBe(0);
    expect(out.belowMinimumLot).toBe(true);
    expect(out.riskAmount).toBe(0);
  });

  it("[UNIT] a cross pair converts quote-currency risk with the supplied rate", () => {
    // 0.0100 stop x 100k = 1000 AUD/lot → 660 USD/lot; $100 budget → 0.15 lots.
    const out = calculateRisk(
      { instrument: "GBPAUD", entryPrice: 1.95, stopLoss: 1.94 },
      profile({ accountCurrency: "USD" }),
      { AUDUSD: 0.66 },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.quoteCurrency).toBe("AUD");
    expect(out.conversionRate).toBeCloseTo(0.66, 12);
    expect(out.lots).toBeCloseTo(0.15, 10);
  });
});

describe("calculateRisk — position-size invariants (property, fixed seed)", () => {
  it("[INVARIANT] realised risk never exceeds the budget, lots land on the lot step, outputs are finite", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.keys(CONTRACT_SPECS)),
        fc.double({ min: 100, max: 5_000_000, noNaN: true }),
        fc.double({ min: 0.05, max: 10, noNaN: true }),
        fc.double({ min: 0.5, max: 3000, noNaN: true }),
        fc.double({ min: 0.0001, max: 0.05, noNaN: true }),
        fc.constantFrom<"long" | "short">("long", "short"),
        (instrument, accountEquity, riskPerTradePercent, entryPrice, stopFraction, side) => {
          const stopDistance = Math.max(entryPrice * stopFraction, 1e-6);
          const stopLoss = side === "long" ? entryPrice - stopDistance : entryPrice + stopDistance;
          if (!(stopLoss > 0)) return true;
          const out = calculateRisk(
            { instrument, entryPrice, stopLoss },
            profile({ accountEquity, riskPerTradePercent, accountCurrency: "USD" }),
            { AUDUSD: 0.66, GBPUSD: 1.27 },
          );
          if (!out.ok) return true;
          const budget = accountEquity * (riskPerTradePercent / 100);
          expect(out.riskBudget).toBeCloseTo(budget, 6);
          expect(out.riskAmount).toBeLessThanOrEqual(budget * (1 + 1e-9) + 1e-9);
          expect(out.lots).toBeGreaterThanOrEqual(0);
          for (const v of [out.lots, out.riskAmount, out.notional, out.marginRequired, out.stopPercent]) {
            expect(Number.isFinite(v)).toBe(true);
          }
          const step = CONTRACT_SPECS[instrument]!.lotStep;
          expect(Math.abs(out.lots / step - Math.round(out.lots / step))).toBeLessThan(1e-6);
          return true;
        },
      ),
      { seed: SEED, numRuns: 300 },
    );
  });

  it("[INVARIANT] a stop on the wrong side of entry sizes identically to its mirror", () => {
    const long = calculateRisk({ instrument: "EURUSD", entryPrice: 1.1, stopLoss: 1.095 }, profile());
    const short = calculateRisk({ instrument: "EURUSD", entryPrice: 1.1, stopLoss: 1.105 }, profile());
    expect(long.ok && short.ok).toBe(true);
    if (!long.ok || !short.ok) return;
    expect(long.lots).toBeCloseTo(short.lots, 12);
  });
});
