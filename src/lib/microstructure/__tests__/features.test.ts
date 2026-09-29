import { describe, expect, it } from "vitest";
import { buildVolumeProfile, computeTradeFlowFeatures } from "../features";
import type { TradePrint } from "../types";

const trades: TradePrint[] = [
  { eventTime: "2026-09-29T10:00:00.000Z", price: 4100.1, size: 3, aggressorSide: "sell" },
  { eventTime: "2026-09-29T10:00:00.100Z", price: 4100.1, size: 2, aggressorSide: "buy" },
  { eventTime: "2026-09-29T10:00:00.200Z", price: 4100.2, size: 6, aggressorSide: "buy" },
  { eventTime: "2026-09-29T10:00:00.300Z", price: 4100.2, size: 1, aggressorSide: "sell" },
  { eventTime: "2026-09-29T10:00:00.400Z", price: 4100.3, size: 2, aggressorSide: "unknown" },
];

describe("microstructure trade-flow features", () => {
  it("[UNIT] computes exchange-side delta without treating unknown prints as directional", () => {
    const result = computeTradeFlowFeatures(trades, 0.1);

    expect(result.tradeCount).toBe(5);
    expect(result.totalVolume).toBe(14);
    expect(result.buyVolume).toBe(8);
    expect(result.sellVolume).toBe(4);
    expect(result.unknownVolume).toBe(2);
    expect(result.delta).toBe(4);
    expect(result.deltaRatio).toBeCloseTo(4 / 12);
    expect(result.priceChange).toBeCloseTo(0.2);
  });

  it("[UNIT] builds a deterministic price profile and POC", () => {
    const profile = buildVolumeProfile(trades, 0.1);

    expect(profile.totalVolume).toBe(14);
    expect(profile.poc).toBe(4100.2);
    expect(profile.levels).toHaveLength(3);
    expect(profile.valueAreaLow).toBe(4100.1);
    expect(profile.valueAreaHigh).toBe(4100.2);
  });

  it("[INVARIANT] fails closed on an invalid tick size", () => {
    expect(() => buildVolumeProfile(trades, 0)).toThrow("tickSize must be positive");
  });
});
