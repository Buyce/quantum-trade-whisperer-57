/**
 * Blocking tests for detection provenance (R7 candle finality + R8 provider symbol).
 *
 * Classes:
 *  [INVARIANT] nothing is inferred: a timeframe with no bars yields a NULL as-of,
 *              never "now" and never another timeframe's bar time.
 *  [INVARIANT] rows written before provenance existed stay NULL, so they can never
 *              be mistaken for policy-stamped Wave 1 evidence.
 *  [UNIT]      as-of selection, source labelling and comparability rules.
 */
import { describe, expect, it } from "vitest";

import {
  buildDetectionProvenance,
  comparableProvenance,
  provenanceColumns,
} from "../provenance";
import { LIVE_CANDLE_POLICY_VERSION, RESEARCH_CANDLE_POLICY_VERSION } from "../candle-policy";

const bar = (timeframe: string, lastBarTime: string | null, bars = 200) => ({
  timeframe,
  lastBarTime,
  bars,
});

describe("buildDetectionProvenance", () => {
  it("[UNIT] stamps the live policy and the newest bar time across timeframes", () => {
    const p = buildDetectionProvenance({
      candles: [
        bar("H4", "2026-08-25T08:00:00.000Z"),
        bar("H1", "2026-08-25T12:00:00.000Z"),
        bar("M15", "2026-08-25T12:45:00.000Z"),
      ],
      providerSymbol: "EURUSD.raw",
      mappingVerifiedAt: "2026-08-25T02:40:00.000Z",
    });

    expect(p.candlePolicyVersion).toBe(LIVE_CANDLE_POLICY_VERSION);
    expect(p.candleAsOf).toBe("2026-08-25T12:45:00.000Z");
    expect(p.candleSource).toBe("metaapi:EURUSD.raw");
    expect(p.providerSymbol).toBe("EURUSD.raw");
    expect(p.mappingVerifiedAt).toBe("2026-08-25T02:40:00.000Z");
  });

  it("[INVARIANT] never invents an as-of when no bars were read", () => {
    const p = buildDetectionProvenance({ candles: [bar("M15", null, 0)], providerSymbol: null });
    expect(p.candleAsOf).toBeNull();
    expect(p.candleSource).toBeNull();
    expect(p.quoteAsOf).toBeNull();
    expect(p.specAsOf).toBeNull();
  });

  it("[UNIT] refuses an unknown candle policy version instead of guessing", () => {
    expect(() =>
      buildDetectionProvenance({ candles: [], providerSymbol: "EURUSD", policyVersion: 99 }),
    ).toThrow(/unknown candle policy/);
  });
});

describe("provenanceColumns", () => {
  it("[INVARIANT] emits all-NULL columns for a pre-provenance row", () => {
    expect(provenanceColumns(null)).toEqual({
      candle_policy_version: null,
      candle_as_of: null,
      candle_source: null,
      provider_symbol: null,
      mapping_verified_at: null,
      quote_as_of: null,
      spec_as_of: null,
    });
  });
});

describe("comparableProvenance", () => {
  it("[INVARIANT] live and research candle finality are not comparable", () => {
    const live = buildDetectionProvenance({ candles: [], providerSymbol: "EURUSD" });
    const research = buildDetectionProvenance({
      candles: [],
      providerSymbol: "EURUSD",
      policyVersion: RESEARCH_CANDLE_POLICY_VERSION,
    });
    expect(comparableProvenance(live, research)).toBe(false);
    expect(comparableProvenance(live, live)).toBe(true);
  });

  it("[INVARIANT] a missing provenance record is never comparable", () => {
    const live = buildDetectionProvenance({ candles: [], providerSymbol: "EURUSD" });
    expect(comparableProvenance(live, null)).toBe(false);
    expect(comparableProvenance(null, null)).toBe(false);
  });
});
