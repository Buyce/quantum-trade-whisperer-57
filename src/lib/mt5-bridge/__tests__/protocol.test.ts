import { describe, expect, it } from "vitest";
import { validateMt5BridgeSnapshot, type Mt5BridgeSnapshot } from "../protocol";

function snapshot(): Mt5BridgeSnapshot {
  return {
    protocolVersion: 1,
    bridgeId: "bridge_test",
    sequence: 1,
    observedAt: "2026-09-30T00:00:00.000Z",
    terminal: { connected: true, tradeAllowed: true, build: 5000, name: "MT5", path: null },
    account: {
      provider: "mt5_direct",
      observedAt: "2026-09-30T00:00:00.000Z",
      accountKey: "123",
      platform: "mt5",
      mode: "demo",
      loginMasked: "***123",
      server: "Demo",
      broker: "Broker",
      currency: "USD",
      balance: 10000,
      equity: 10000,
      margin: 0,
      freeMargin: 10000,
      marginLevel: null,
      leverage: 100,
      tradeAllowed: true,
    },
    positions: [],
    orders: [],
  };
}

describe("MT5 direct bridge protocol", () => {
  it("[INVARIANT] accepts a versioned direct-MT5 broker snapshot", () => {
    expect(validateMt5BridgeSnapshot(snapshot())).toEqual([]);
  });

  it("[INVARIANT] refuses snapshots pretending to be another provider", () => {
    const value = snapshot();
    value.account.provider = "metaapi";
    expect(validateMt5BridgeSnapshot(value)).toContain("provider");
  });

  it("[INVARIANT] requires monotonic-capable non-negative sequence values", () => {
    const value = snapshot();
    value.sequence = -1;
    expect(validateMt5BridgeSnapshot(value)).toContain("sequence");
  });
});
