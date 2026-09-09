import { describe, expect, it } from "vitest";

import {
  alignmentOf,
  directionOf,
  dollarLeg,
  positioningBias,
  volRegimeOf,
} from "@/lib/context/derive";
import { CFTC_MARKETS, FRED_SERIES, parseVixCsv } from "@/lib/context/fetch.server";

describe("market-context derivation", () => {
  it("reports no direction from a single observation instead of guessing flat", () => {
    expect(directionOf([{ observationDate: "2026-01-02", value: 104.2 }])).toBeNull();
    expect(directionOf([])).toBeNull();
  });

  it("reads direction from the two newest observations regardless of input order", () => {
    const rising = [
      { observationDate: "2026-01-02", value: 100 },
      { observationDate: "2026-01-05", value: 101 },
    ];
    expect(directionOf(rising)).toBe("up");
    expect(directionOf([...rising].reverse())).toBe("up");
    expect(
      directionOf([
        { observationDate: "2026-01-02", value: 100 },
        { observationDate: "2026-01-05", value: 99 },
      ]),
    ).toBe("down");
  });

  it("calls a move inside the flat band flat", () => {
    expect(
      directionOf([
        { observationDate: "2026-01-02", value: 100 },
        { observationDate: "2026-01-05", value: 100.05 },
      ]),
    ).toBe("flat");
  });

  it("returns no volatility regime when no VIX reading is held", () => {
    expect(volRegimeOf([])).toBeNull();
    expect(volRegimeOf([{ observationDate: "2026-01-05", value: Number.NaN }])).toBeNull();
  });

  it("bands the volatility regime on the newest VIX level", () => {
    expect(volRegimeOf([{ observationDate: "2026-01-05", value: 12 }])).toBe("calm");
    expect(volRegimeOf([{ observationDate: "2026-01-05", value: 19 }])).toBe("normal");
    expect(volRegimeOf([{ observationDate: "2026-01-05", value: 31 }])).toBe("stressed");
  });

  it("knows which side of a pair the dollar sits on, and admits when it does not", () => {
    expect(dollarLeg("USDJPY")).toBe("base");
    expect(dollarLeg("EURUSD")).toBe("quote");
    expect(dollarLeg("XAUUSD")).toBe("quote");
    expect(dollarLeg("GBPAUD")).toBeNull();
    expect(dollarLeg("USTEC")).toBeNull();
  });

  it("aligns direction against the dollar move", () => {
    // Dollar up: USDJPY long agrees, EURUSD long disagrees.
    expect(alignmentOf("USDJPY", "long", "up")).toBe("aligned");
    expect(alignmentOf("EURUSD", "long", "up")).toBe("against");
    expect(alignmentOf("EURUSD", "short", "up")).toBe("aligned");
    expect(alignmentOf("XAUUSD", "long", "down")).toBe("aligned");
  });

  it("never claims alignment when the dollar move or the pair's leg is unknown", () => {
    expect(alignmentOf("EURUSD", "long", null)).toBeNull();
    expect(alignmentOf("GBPAUD", "long", "up")).toBeNull();
    expect(alignmentOf("EURUSD", "long", "flat")).toBe("neutral");
  });

  it("leaves positioning bias unknown when no net figure exists", () => {
    expect(positioningBias(null)).toBeNull();
    expect(positioningBias(undefined)).toBeNull();
    expect(positioningBias(Number.NaN)).toBeNull();
    expect(positioningBias(0)).toBe("flat");
    expect(positioningBias(12_000)).toBe("long");
    expect(positioningBias(-12_000)).toBe("short");
  });
});

describe("market-context sources", () => {
  it("maps a fixed set of official series and futures markets", () => {
    expect(Object.keys(FRED_SERIES)).toContain("DTWEXBGS");
    expect(FRED_SERIES["DGS10"]?.key).toBe("us_10y_yield");
    expect(Object.values(CFTC_MARKETS)).toEqual(
      expect.arrayContaining(["EUR", "GBP", "JPY", "AUD", "CAD", "CHF"]),
    );
  });

  it("parses the CBOE VIX csv and drops rows it cannot read", () => {
    const csv = [
      "DATE,OPEN,HIGH,LOW,CLOSE",
      "2026-01-05,17.1,18.0,16.8,17.55",
      "2026-01-06,17.5,18.2,17.0,n/a",
      "2025-01-06,17.5,18.2,17.0,20.0",
      "bad row",
    ].join("\n");
    const rows = parseVixCsv(csv, "2026-01-01");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      seriesKey: "vix",
      observationDate: "2026-01-05",
      value: 17.55,
    });
  });
});
