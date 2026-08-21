import { describe, expect, it } from "vitest";
import { ACTIVE_MODEL_LABEL, ACTIVE_MODEL_VERSION, observationKey } from "../versioning";

describe("model version identity", () => {
  it("[V1_CHARACTERIZATION] the active engine version is pinned to 1", () => {
    // Bumping this is a deliberate model change and must fail this test first,
    // forcing the baseline/characterisation review described in CHARACTERISATION.md.
    expect(ACTIVE_MODEL_VERSION).toBe(1);
    expect(ACTIVE_MODEL_LABEL).toBe("V1 production engine");
  });

  it("[UNIT] the observation key pairs one scan cycle's read of one instrument", () => {
    expect(observationKey("run-1", "EURUSD")).toBe("run-1:EURUSD");
  });

  it("[INVARIANT] V1 and a future V2 evaluating the same cycle share an identical key", () => {
    // This is what makes any V1/V2 difference attributable to logic, not data.
    const v1 = observationKey("run-1", "XAUUSD");
    const v2 = observationKey("run-1", "XAUUSD");
    expect(v1).toBe(v2);
    expect(observationKey("run-2", "XAUUSD")).not.toBe(v1);
    expect(observationKey("run-1", "GBPAUD")).not.toBe(v1);
  });

  it("[INVARIANT] a missing run id or instrument yields null, never a partial key", () => {
    expect(observationKey(null, "EURUSD")).toBeNull();
    expect(observationKey(undefined, "EURUSD")).toBeNull();
    expect(observationKey("", "EURUSD")).toBeNull();
    expect(observationKey("run-1", "")).toBeNull();
  });
});
