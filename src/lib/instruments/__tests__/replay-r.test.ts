import { describe, expect, it } from "vitest";
import { replayR } from "../advancement.server";

describe("advancement replay R", () => {
  it("[INVARIANT] null net_r falls back to realized_r instead of 0", () => {
    expect(replayR({ net_r: null, realized_r: -1 })).toBe(-1);
  });
  it("[UNIT] both unavailable yields null", () => {
    expect(replayR({ net_r: null, realized_r: null })).toBeNull();
  });
  it("[UNIT] positive and negative net_r are kept", () => {
    expect(replayR({ net_r: 1.5, realized_r: 2 })).toBe(1.5);
    expect(replayR({ net_r: -0.8, realized_r: 2 })).toBe(-0.8);
  });
});
