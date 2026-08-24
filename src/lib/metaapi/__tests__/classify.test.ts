import { describe, expect, it } from "vitest";
import {
  classifyAccountType,
  connectionPhase,
  isMt5Netting,
  isReadOnly,
  isReady,
  modeEligibility,
  riskGuardianAvailability,
} from "../classify";
import type { BrokerAccountInformation } from "../types";

const demo: BrokerAccountInformation = {
  platform: "mt5",
  type: "ACCOUNT_TRADE_MODE_DEMO",
  marginMode: "ACCOUNT_MARGIN_MODE_RETAIL_HEDGING",
  tradeAllowed: true,
  investorMode: false,
};
const real: BrokerAccountInformation = { ...demo, type: "ACCOUNT_TRADE_MODE_REAL" };

const gates = { globalDemoAuto: true, globalLiveConfirm: false, globalLiveAuto: false };

describe("broker account classification", () => {
  it("[UNIT] maps the broker's own trade mode", () => {
    expect(classifyAccountType(demo)).toBe("demo");
    expect(classifyAccountType(real)).toBe("real");
    expect(classifyAccountType({ type: "ACCOUNT_TRADE_MODE_CONTEST" })).toBe("contest");
  });

  it("[INVARIANT] an unreadable trade mode is unknown, never demo", () => {
    for (const type of [null, undefined, "", "SOMETHING_NEW"]) {
      expect(classifyAccountType({ type: type as string | null })).toBe("unknown");
    }
  });

  it("[INVARIANT] a missing tradeAllowed flag reads as read-only", () => {
    expect(isReadOnly({ ...demo, tradeAllowed: null })).toBe(true);
    expect(isReadOnly({ ...demo, investorMode: true })).toBe(true);
    expect(isReadOnly(demo)).toBe(false);
  });

  it("[UNIT] detects MT5 netting accounts", () => {
    const netting = { ...demo, marginMode: "ACCOUNT_MARGIN_MODE_RETAIL_NETTING" };
    expect(isMt5Netting(netting)).toBe(true);
    expect(isMt5Netting({ ...netting, platform: "mt4" })).toBe(false);
    expect(isMt5Netting(demo)).toBe(false);
  });

  it("[INVARIANT] Risk Guardian is reported unavailable on MT5 netting accounts", () => {
    const verdict = riskGuardianAvailability(
      { ...demo, marginMode: "ACCOUNT_MARGIN_MODE_RETAIL_NETTING" },
      true,
    );
    expect(verdict.available).toBe(false);
    expect(verdict.reason).toMatch(/netting/i);
    expect(riskGuardianAvailability(demo, false).available).toBe(false);
    expect(riskGuardianAvailability(demo, true).available).toBe(true);
  });
});

describe("mode eligibility", () => {
  it("[UNIT] observe is always allowed, including read-only connections", () => {
    expect(
      modeEligibility("observe", {
        info: { ...demo, investorMode: true },
        userEnabled: false,
        ...gates,
      }).allowed,
    ).toBe(true);
  });

  it("[UNIT] demo auto needs a broker-confirmed demo account plus both opt-ins", () => {
    expect(modeEligibility("demo_auto", { info: demo, userEnabled: true, ...gates }).allowed).toBe(
      true,
    );
    expect(modeEligibility("demo_auto", { info: demo, userEnabled: false, ...gates }).allowed).toBe(
      false,
    );
    expect(
      modeEligibility("demo_auto", {
        info: demo,
        userEnabled: true,
        ...gates,
        globalDemoAuto: false,
      }).allowed,
    ).toBe(false);
  });

  it("[INVARIANT] demo auto is refused on real, contest and unknown accounts", () => {
    for (const info of [
      real,
      { ...demo, type: "ACCOUNT_TRADE_MODE_CONTEST" },
      { ...demo, type: null },
    ]) {
      expect(modeEligibility("demo_auto", { info, userEnabled: true, ...gates }).allowed).toBe(
        false,
      );
    }
  });

  it("[INVARIANT] every live mode is refused while the global live gates are off", () => {
    for (const mode of ["live_confirm", "live_auto"] as const) {
      const verdict = modeEligibility(mode, { info: real, userEnabled: true, ...gates });
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toMatch(/not currently enabled/i);
    }
  });

  it("[INVARIANT] no executing mode is allowed on a read-only connection", () => {
    for (const mode of ["demo_auto", "live_confirm", "live_auto"] as const) {
      expect(
        modeEligibility(mode, {
          info: { ...demo, investorMode: true },
          userEnabled: true,
          ...gates,
          globalLiveConfirm: true,
          globalLiveAuto: true,
        }).allowed,
      ).toBe(false);
    }
  });
});

describe("provisioning lifecycle", () => {
  it("[UNIT] credentials not yet submitted never reads as connected", () => {
    expect(
      connectionPhase({ state: "DRAFT", connectionStatus: null, credentialsConfigured: false }),
    ).toBe("awaiting_credentials");
  });

  it("[UNIT] deployed but not connected is distinct from connected", () => {
    expect(
      connectionPhase({
        state: "DEPLOYED",
        connectionStatus: "DISCONNECTED",
        credentialsConfigured: true,
      }),
    ).toBe("deployed_not_connected");
    expect(
      connectionPhase({
        state: "DEPLOYED",
        connectionStatus: "CONNECTED",
        credentialsConfigured: true,
      }),
    ).toBe("connected");
    expect(
      connectionPhase({
        state: "DEPLOYED",
        connectionStatus: "DISCONNECTED_FROM_BROKER",
        credentialsConfigured: true,
      }),
    ).toBe("broker_rejected");
    expect(
      connectionPhase({
        state: "DEPLOY_FAILED",
        connectionStatus: null,
        credentialsConfigured: true,
      }),
    ).toBe("failed");
  });

  it("[INVARIANT] readiness requires a connected phase AND a known account type", () => {
    expect(isReady("connected", "demo")).toBe(true);
    expect(isReady("connected", "unknown")).toBe(false);
    expect(isReady("deployed_not_connected", "demo")).toBe(false);
  });
});
