import { describe, expect, it } from "vitest";
import { calendarForAssetClass, calendarUsable, marketStateAt } from "../calendars";

describe("crypto market calendar", () => {
  it("does not inherit the FX weekend closure", () => {
    const cal = calendarForAssetClass("crypto");
    expect(cal?.key).toBe("crypto_24x7");
    expect(cal && calendarUsable(cal).usable).toBe(true);
    expect(cal && marketStateAt(cal, new Date("2026-09-27T12:00:00Z")).state).toBe("open");
  });

  it("keeps broker CFD maintenance windows outside the generic calendar", () => {
    const cal = calendarForAssetClass("crypto");
    expect(cal?.dailyBreaks).toEqual([]);
    expect(cal?.note).toContain("Broker-specific CFD maintenance windows");
  });
});
