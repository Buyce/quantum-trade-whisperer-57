import { describe, expect, it } from "vitest";
import { assetClassOf, instrumentDefinition, WAVE0_SYMBOLS, WAVE2_SYMBOLS } from "../registry";

describe("BTCUSD dark admission", () => {
  it("exists as crypto without guessed broker geometry", () => {
    const btc = instrumentDefinition("BTCUSD");
    expect(btc?.assetClass).toBe("crypto");
    expect(btc?.contractSize).toBeNull();
    expect(btc?.lotStep).toBeNull();
    expect(btc?.minLot).toBeNull();
    expect(btc?.spreadFloor).toBeNull();
    expect(assetClassOf("BTCUSD")).toBe("crypto");
  });

  it("does not widen the frozen production universe", () => {
    expect(WAVE0_SYMBOLS).not.toContain("BTCUSD");
    expect(WAVE2_SYMBOLS).toContain("BTCUSD");
  });
});
