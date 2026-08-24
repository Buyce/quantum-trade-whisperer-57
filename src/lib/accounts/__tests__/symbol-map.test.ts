import { describe, expect, it } from "vitest";
import {
  describeMapping,
  isBrokerSuffix,
  isMappingUsable,
  mapSymbol,
  mapSymbols,
} from "../symbol-map";

describe("connected-account symbol mapping", () => {
  it("[UNIT] prefers an exact broker symbol name", () => {
    const m = mapSymbol("XAUUSD", ["EURUSD", "XAUUSD", "XAUUSD.a"]);
    expect(m.kind).toBe("exact");
    expect(m.brokerSymbol).toBe("XAUUSD");
  });

  it("[UNIT] matches a single broker suffix variant", () => {
    expect(mapSymbol("XAUUSD", ["XAUUSD.a", "EURUSD.a"])).toMatchObject({
      kind: "suffix",
      brokerSymbol: "XAUUSD.a",
    });
    expect(mapSymbol("EURUSD", ["EURUSDm"])).toMatchObject({
      kind: "suffix",
      brokerSymbol: "EURUSDm",
    });
  });

  it("[INVARIANT] refuses to guess when several broker symbols could match", () => {
    const m = mapSymbol("XAUUSD", ["XAUUSD.a", "XAUUSD.pro", "XAUUSDm"]);
    expect(m.kind).toBe("ambiguous");
    expect(m.brokerSymbol).toBeNull();
    expect(m.candidates).toEqual(["XAUUSD.a", "XAUUSD.pro", "XAUUSDm"]);
    expect(isMappingUsable(m)).toBe(false);
  });

  it("[INVARIANT] reports an instrument the broker does not offer as unavailable", () => {
    const m = mapSymbol("GBPAUD", ["EURUSD", "XAUUSD"]);
    expect(m.kind).toBe("unavailable");
    expect(m.brokerSymbol).toBeNull();
    expect(isMappingUsable(m)).toBe(false);
  });

  it("[INVARIANT] never treats a currency-code remainder as a broker suffix", () => {
    // GBPAUDUSD is a different instrument, not a decorated GBPAUD.
    expect(isBrokerSuffix("USD")).toBe(false);
    expect(mapSymbol("GBPAUD", ["GBPAUDUSD"]).kind).toBe("unavailable");
  });

  it("[UNIT] accepts separator and tag suffixes but not arbitrary tails", () => {
    expect(isBrokerSuffix(".a")).toBe(true);
    expect(isBrokerSuffix("-pro")).toBe(true);
    expect(isBrokerSuffix("_ecn")).toBe(true);
    expect(isBrokerSuffix("")).toBe(false);
    expect(isBrokerSuffix(".verylongsuffixhere")).toBe(false);
  });

  it("[UNIT] deduplicates and ignores blank broker entries", () => {
    const m = mapSymbol("EURUSD", [" EURUSD ", "EURUSD", "", "  "]);
    expect(m.kind).toBe("exact");
    expect(m.candidates).toEqual(["EURUSD"]);
  });

  it("[UNIT] maps every requested instrument, in order", () => {
    const all = mapSymbols(["XAUUSD", "GBPAUD", "EURUSD"], ["XAUUSD.a", "EURUSD"]);
    expect(all.map((m) => m.kind)).toEqual(["suffix", "unavailable", "exact"]);
  });

  it("[INVARIANT] ambiguous copy states that P-Trades will not choose", () => {
    const text = describeMapping(mapSymbol("XAUUSD", ["XAUUSD.a", "XAUUSD.b"]));
    expect(text).toMatch(/will not guess/i);
  });
});
