/**
 * A user must never be offered an instrument the lifecycle forbids from
 * publishing, and the Feed strip must never describe a merely-measured
 * instrument as "live feed" just because its broker feed is reachable.
 */
import { describe, expect, it } from "vitest";

import { feedChipLabel } from "@/components/MarketStatus";
import { ALL_INSTRUMENTS, instrumentCapability, publishableInstruments } from "@/lib/db-types";

const DEPLOYED = [
  { symbol: "XAUUSD", stage: "execution_approved" },
  { symbol: "GBPAUD", stage: "execution_approved" },
  { symbol: "EURUSD", stage: "execution_approved" },
  { symbol: "GBPUSD", stage: "data_validation" },
  { symbol: "AUDUSD", stage: "data_validation" },
  { symbol: "USDCAD", stage: "data_validation" },
  { symbol: "USDCHF", stage: "data_validation" },
  { symbol: "USDJPY", stage: "data_validation" },
  { symbol: "XAGUSD", stage: "disabled" },
  { symbol: "USOIL", stage: "disabled" },
  { symbol: "UKOIL", stage: "disabled" },
  { symbol: "NAS100", stage: "disabled" },
];

describe("user-visible instrument capability", () => {
  it("[INVARIANT] only publishing stages are selectable", () => {
    expect(publishableInstruments(DEPLOYED)).toEqual(["XAUUSD", "GBPAUD", "EURUSD"]);
  });

  it("[INVARIANT] a data_validation pair is never offered", () => {
    for (const symbol of ["GBPUSD", "AUDUSD", "USDCAD", "USDCHF", "USDJPY"]) {
      expect(publishableInstruments(DEPLOYED)).not.toContain(symbol);
    }
  });

  it("[INVARIANT] an unreadable stage view falls back to Wave 0", () => {
    expect(publishableInstruments(null)).toEqual(ALL_INSTRUMENTS);
    expect(publishableInstruments([])).toEqual(ALL_INSTRUMENTS);
  });

  it("a promoted signals_only pair becomes selectable without a code change", () => {
    const promoted = DEPLOYED.map((r) =>
      r.symbol === "GBPUSD" ? { symbol: "GBPUSD", stage: "signals_only" } : r,
    );
    expect(publishableInstruments(promoted)).toContain("GBPUSD");
  });

  it("capability distinguishes measuring from publishable and out of service", () => {
    expect(instrumentCapability("EURUSD", DEPLOYED)).toBe("publishable");
    expect(instrumentCapability("USDJPY", DEPLOYED)).toBe("measuring");
    expect(instrumentCapability("NAS100", DEPLOYED)).toBe("unavailable");
  });

  it("[INVARIANT] a reachable feed for a measured pair is not called live", () => {
    expect(feedChipLabel(true, "measuring")).toBe("measuring — not published yet");
    expect(feedChipLabel(true, "publishable")).toBe("live feed");
    expect(feedChipLabel(false, "publishable")).toBe("feed down");
    expect(feedChipLabel(true, "unavailable")).toBe("not in service");
  });
});
