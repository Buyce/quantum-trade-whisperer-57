import { describe, expect, it } from "vitest";
import { standDownPatch } from "../mode";

describe("stand-down reason is kept", () => {
  it("records the reason when an armed account is stood down", () => {
    expect(
      standDownPatch("live_auto", { mode: "observe", standDownReason: "trading is not allowed" }),
    ).toBe("trading is not allowed");
  });
  it("a later refresh in Observe leaves the saved reason alone", () => {
    expect(standDownPatch("observe", { mode: "observe", standDownReason: null })).toBeUndefined();
  });
  it("clears the reason once the account is armed again", () => {
    expect(standDownPatch("live_auto", { mode: "live_auto", standDownReason: null })).toBeNull();
  });
});
