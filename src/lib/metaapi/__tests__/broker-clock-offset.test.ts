import { describe, expect, it } from "vitest";
import { correctBrokerClockOffset } from "../quote";

const now = Date.parse("2026-11-17T10:42:41.676Z");

describe("broker clock offset correction", () => {
  it("[INVARIANT] a live price stamped exactly one hour behind is corrected", () => {
    const r = correctBrokerClockOffset("2026-11-17T09:42:40.000Z", now);
    expect(r.offsetHours).toBe(1);
    expect(r.sourceTime).toBe("2026-11-17T10:42:40.000Z");
  });
  it("[INVARIANT] a price frozen for 1h05m stays stale", () => {
    const r = correctBrokerClockOffset("2026-11-17T09:37:40.000Z", now);
    expect(r.offsetHours).toBe(0);
  });
  it("[INVARIANT] offsets above 3 hours are never corrected", () => {
    expect(correctBrokerClockOffset("2026-11-17T06:42:41.000Z", now).offsetHours).toBe(0);
  });
});
