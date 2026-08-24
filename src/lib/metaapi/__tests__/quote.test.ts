import { describe, expect, it } from "vitest";

import {
  QUOTE_FUTURE_SKEW_MS,
  quoteSourceAgeMs,
  quoteSourceFresh,
  validQuoteGeometry,
} from "../quote";

const NOW = Date.parse("2026-08-24T00:00:00.000Z");

describe("broker quote validity", () => {
  it("[UNIT] accepts an ordinary bid/ask pair", () => {
    expect(validQuoteGeometry(1.1, 1.1002)).toBe(true);
  });

  it("[INVARIANT] rejects crossed, nonpositive and nonfinite prices", () => {
    expect(validQuoteGeometry(1.2, 1.1)).toBe(false);
    expect(validQuoteGeometry(0, 1)).toBe(false);
    expect(validQuoteGeometry(1, Number.NaN)).toBe(false);
  });

  it("[INVARIANT] rejects stale and implausibly future-dated source times", () => {
    expect(quoteSourceFresh(new Date(NOW - 5_000).toISOString(), 90_000, NOW)).toBe(true);
    expect(quoteSourceFresh(new Date(NOW - 90_001).toISOString(), 90_000, NOW)).toBe(false);
    expect(
      quoteSourceFresh(new Date(NOW + QUOTE_FUTURE_SKEW_MS + 1).toISOString(), 90_000, NOW),
    ).toBe(false);
    expect(quoteSourceFresh(null, 90_000, NOW)).toBe(false);
    expect(quoteSourceAgeMs("not-a-date", NOW)).toBeNull();
  });
});
