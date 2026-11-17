import { describe, expect, it } from "vitest";
import { assessChronology } from "../chronology";

describe("assessChronology", () => {
  it("[UNIT] flags ticket 49064728: entry one whole hour before submission", () => {
    const r = assessChronology({
      detectedAt: "2026-11-17T11:30:35.242Z",
      submittedAt: "2026-11-17T11:36:06.184Z",
      entryAt: "2026-11-17T10:36:07.332Z",
      exitAt: "2026-11-17T11:51:49.645Z",
    });
    expect(r.status).toBe("suspect");
    expect(r.entryHourOffset).toBe(1);
  });
  it("[UNIT] validates a normal fill one second after submission", () => {
    const r = assessChronology({ submittedAt: "2026-11-17T11:36:06Z", entryAt: "2026-11-17T11:36:07Z", exitAt: "2026-11-17T11:51:49Z" });
    expect(r.status).toBe("validated");
  });
  it("[UNIT] is unknown when entry time is missing", () => {
    expect(assessChronology({ submittedAt: "2026-11-17T11:36:06Z", entryAt: null }).status).toBe("unknown");
  });
  it("[UNIT] flags exit before entry", () => {
    const r = assessChronology({ submittedAt: "2026-11-17T11:00:00Z", entryAt: "2026-11-17T11:00:01Z", exitAt: "2026-11-17T10:00:00Z" });
    expect(r.reasons).toContain("exit precedes entry");
  });
  it("[UNIT] does not label a non-whole-hour gap as an hour offset", () => {
    const r = assessChronology({ submittedAt: "2026-11-17T11:36:06Z", entryAt: "2026-11-17T11:00:00Z" });
    expect(r.status).toBe("suspect");
    expect(r.entryHourOffset).toBeNull();
  });
  it("[UNIT] handles a DST-boundary night (European clocks change 2026-10-25 01:00Z) by UTC only", () => {
    const r = assessChronology({ submittedAt: "2026-10-25T00:59:59Z", entryAt: "2026-10-25T01:00:00Z" });
    expect(r.status).toBe("validated");
  });
});
