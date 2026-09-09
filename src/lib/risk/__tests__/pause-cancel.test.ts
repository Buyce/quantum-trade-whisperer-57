import { describe, expect, it } from "vitest";
import { matchingUnfilledDeliveries } from "../pause-cancel";

describe("matchingUnfilledDeliveries", () => {
  it("returns ids that match instrument and direction of losses", () => {
    const losses = [
      { instrument: "XAUUSD", direction: "short" },
      { instrument: "EURUSD", direction: "long" },
    ];
    const unfilled = [
      { id: 1, instrument: "XAUUSD", direction: "short" },
      { id: 2, instrument: "XAUUSD", direction: "long" },
      { id: 3, instrument: "EURUSD", direction: "long" },
      { id: 4, instrument: "GBPUSD", direction: "short" },
    ];
    const result = matchingUnfilledDeliveries(losses, unfilled);
    expect(result).toContain(1);
    expect(result).toContain(3);
    expect(result).not.toContain(2);
    expect(result).not.toContain(4);
  });

  it("normalises case and whitespace", () => {
    const losses = [{ instrument: "xauusd ", direction: "Short" }];
    const unfilled = [{ id: 5, instrument: " XAUUSD", direction: "short" }];
    expect(matchingUnfilledDeliveries(losses, unfilled)).toEqual([5]);
  });

  it("deduplicates multiple losses for the same pair/direction", () => {
    const losses = [
      { instrument: "XAUUSD", direction: "short" },
      { instrument: "XAUUSD", direction: "short" },
    ];
    const unfilled = [{ id: 6, instrument: "XAUUSD", direction: "short" }];
    expect(matchingUnfilledDeliveries(losses, unfilled)).toEqual([6]);
  });

  it("returns nothing when losses have no instrument", () => {
    const losses = [{ instrument: null, direction: "short" }];
    const unfilled = [{ id: 7, instrument: "XAUUSD", direction: "short" }];
    expect(matchingUnfilledDeliveries(losses, unfilled)).toEqual([]);
  });

  it("returns nothing when delivery direction is missing", () => {
    const losses = [{ instrument: "XAUUSD", direction: "short" }];
    const unfilled = [{ id: 8, instrument: "XAUUSD", direction: null }];
    expect(matchingUnfilledDeliveries(losses, unfilled)).toEqual([]);
  });
});
