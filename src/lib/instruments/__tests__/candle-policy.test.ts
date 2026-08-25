import { describe, expect, it } from "vitest";

import {
  CANDLE_POLICIES,
  LIVE_CANDLE_POLICY_VERSION,
  RESEARCH_CANDLE_POLICY_VERSION,
  candlePolicy,
} from "../candle-policy";

describe("candle policy register (R7)", () => {
  it("[INVARIANT] the live Wave 0 policy still reads the forming candle", () => {
    const live = candlePolicy(LIVE_CANDLE_POLICY_VERSION);
    expect(live?.name).toBe("wave0-forming-current-candle-v1");
    // Changing this to "closed" silently redefines every historical Wave 0 grade.
    expect(live?.finality).toBe("forming");
    expect(live?.appliesTo).toBe("wave0_live");
  });

  it("[INVARIANT] research declares closed candles and is a separate version", () => {
    const research = candlePolicy(RESEARCH_CANDLE_POLICY_VERSION);
    expect(research?.finality).toBe("closed");
    expect(RESEARCH_CANDLE_POLICY_VERSION).not.toBe(LIVE_CANDLE_POLICY_VERSION);
  });

  it("[UNIT] versions are unique and an unknown version resolves to null", () => {
    const versions = CANDLE_POLICIES.map((p) => p.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect(candlePolicy(99)).toBeNull();
  });
});
