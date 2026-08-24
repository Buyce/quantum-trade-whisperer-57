import { describe, expect, it } from "vitest";
import { presentSignalBreakdown } from "../copy";

describe("signal explanation presentation", () => {
  it("[INVARIANT] removes unsupported institutional and order-flow implications", () => {
    const presented = presentSignalBreakdown(
      "A+ Grade: institutional confluence. Point C is retesting an institutional order block near an unmitigated H1/H4 institutional zone and the Point C structural liquidity zone. Highest-conviction tier: full 1:3 extension with trailing management is justified. Entry is dynamically offset: the london_new_york_overlap momentum regime rarely retests the structural Point C (1.2345), so the limit sits 0.3 ATR behind the close.",
    );

    expect(presented).toContain("four-rule confluence");
    expect(presented).toContain("OHLC-derived supply/demand zone");
    expect(presented).toContain("H1/H4 OHLC-derived zone");
    expect(presented).toContain("recent-range Point-C test zone");
    expect(presented).toContain("not performance validation or execution advice");
    expect(presented).toContain("unvalidated london_new_york_overlap session offset");
    expect(presented).not.toMatch(/institutional|liquidity zone/i);
    expect(presented).not.toMatch(/highest-conviction|is justified|rarely retests/i);
  });
});
