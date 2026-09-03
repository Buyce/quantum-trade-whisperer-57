import { describe, expect, it } from "vitest";
import { utcMinute } from "@/lib/format-utc";

describe("[UNIT] utcMinute", () => {
  it("formats a valid ISO timestamp to UTC minutes", () => {
    expect(utcMinute("2026-09-03T14:24:03.000Z")).toBe("2026-09-03 14:24");
  });

  it("accepts epoch milliseconds and Date instances", () => {
    expect(utcMinute(Date.UTC(2026, 8, 3, 14, 24))).toBe("2026-09-03 14:24");
    expect(utcMinute(new Date(Date.UTC(2026, 8, 3, 14, 24)))).toBe("2026-09-03 14:24");
  });

  it("never throws on missing or malformed values", () => {
    for (const bad of [null, undefined, "", "not-a-date", NaN, new Date("nope")]) {
      expect(utcMinute(bad as never)).toBe("—");
    }
  });
});
