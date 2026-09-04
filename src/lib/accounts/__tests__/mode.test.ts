import { describe, expect, it } from "vitest";

import { canArm, offerableModes, isAccountMode, ACCOUNT_MODES } from "../mode";

const ready = {
  brokerAccountType: "demo" as const,
  ready: true,
  intentConflict: false,
  tradeAllowed: true,
  investorMode: false,
  hasBrokerConnection: true,
  hasMagic: true,
  emergencyStopped: false,
};

describe("connected account arming rules", () => {
  it("[UNIT] recognises only the four known modes", () => {
    expect(ACCOUNT_MODES).toHaveLength(4);
    expect(isAccountMode("demo_auto")).toBe(true);
    expect(isAccountMode("yolo_auto")).toBe(false);
  });

  it("[INVARIANT] a verified demo account can reach Demo Auto", () => {
    expect(canArm(ready, "demo_auto").ok).toBe(true);
    expect(offerableModes(ready)).toContain("demo_auto");
  });

  it("[INVARIANT] standing down to observe is never blocked", () => {
    const broken = { ...ready, ready: false, tradeAllowed: false, hasBrokerConnection: false };
    expect(canArm(broken, "observe").ok).toBe(true);
  });

  it("[INVARIANT] a demo mode is refused on a real-money account", () => {
    const real = { ...ready, brokerAccountType: "real" as const };
    expect(canArm(real, "demo_auto").ok).toBe(false);
  });

  it("[INVARIANT] a live mode is refused on a demo account", () => {
    expect(canArm(ready, "live_auto").ok).toBe(false);
    expect(canArm(ready, "live_confirm").ok).toBe(false);
  });

  it("[INVARIANT] an investor (read-only) login can never be armed", () => {
    expect(canArm({ ...ready, investorMode: true }, "demo_auto").ok).toBe(false);
  });

  it("[INVARIANT] arming requires the broker to allow trading", () => {
    expect(canArm({ ...ready, tradeAllowed: null }, "demo_auto").ok).toBe(false);
    expect(canArm({ ...ready, tradeAllowed: false }, "demo_auto").ok).toBe(false);
  });

  it("[INVARIANT] a conflicted or unready connection cannot be armed", () => {
    expect(canArm({ ...ready, intentConflict: true }, "demo_auto").ok).toBe(false);
    expect(canArm({ ...ready, ready: false }, "demo_auto").ok).toBe(false);
  });

  it("[INVARIANT] no order tag means evidence cannot be associated, so no arming", () => {
    expect(canArm({ ...ready, hasMagic: false }, "demo_auto").ok).toBe(false);
  });
});
