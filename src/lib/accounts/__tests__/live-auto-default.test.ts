import { describe, expect, it } from "vitest";
import { defaultLiveAutoOnConnect } from "../mode";

const real = {
  brokerAccountType: "real" as const,
  ready: true,
  intentConflict: false,
  tradeAllowed: true,
  investorMode: false,
  hasBrokerConnection: true,
  hasMagic: true,
  emergencyStopped: false,
};

describe("live accounts trade automatically by default", () => {
  it("[INVARIANT] a newly connected real, trade-allowed account becomes Live auto", () => {
    expect(defaultLiveAutoOnConnect("observe", false, real)).toBe("live_auto");
  });
  it("[INVARIANT] an account the owner already turned off is never re-armed", () => {
    expect(defaultLiveAutoOnConnect("observe", true, real)).toBeNull();
  });
  it("[INVARIANT] a real account with trading not allowed is not armed", () => {
    expect(defaultLiveAutoOnConnect("observe", false, { ...real, tradeAllowed: false })).toBeNull();
  });
  it("[INVARIANT] a demo account is never armed for live", () => {
    expect(
      defaultLiveAutoOnConnect("observe", false, { ...real, brokerAccountType: "demo" as const }),
    ).toBeNull();
  });
});
