import { describe, expect, it } from "vitest";
import { formatDuration, isWeekendClosed, marketStatus, scannerSessionOf } from "../market-hours";

const at = (iso: string) => new Date(iso);

describe("scannerSessionOf", () => {
  it("[UNIT] the bucket boundaries match the scanner's own sessionOf", () => {
    expect(scannerSessionOf(at("2026-08-20T22:00:00Z"))).toBe("sydney");
    expect(scannerSessionOf(at("2026-08-20T00:30:00Z"))).toBe("sydney");
    expect(scannerSessionOf(at("2026-08-20T01:00:00Z"))).toBe("tokyo");
    expect(scannerSessionOf(at("2026-08-20T06:59:00Z"))).toBe("tokyo");
    expect(scannerSessionOf(at("2026-08-20T07:00:00Z"))).toBe("london");
    expect(scannerSessionOf(at("2026-08-20T11:59:00Z"))).toBe("london");
    expect(scannerSessionOf(at("2026-08-20T12:00:00Z"))).toBe("london_new_york_overlap");
    expect(scannerSessionOf(at("2026-08-20T15:59:00Z"))).toBe("london_new_york_overlap");
    expect(scannerSessionOf(at("2026-08-20T16:00:00Z"))).toBe("new_york");
    expect(scannerSessionOf(at("2026-08-20T21:59:00Z"))).toBe("new_york");
  });

  it("[INVARIANT] every hour of the day maps to exactly one known bucket", () => {
    const known = new Set(["sydney", "tokyo", "london", "london_new_york_overlap", "new_york"]);
    for (let h = 0; h < 24; h += 1) {
      const s = scannerSessionOf(at(`2026-08-20T${String(h).padStart(2, "0")}:30:00Z`));
      expect(known.has(s)).toBe(true);
    }
  });
});

describe("isWeekendClosed", () => {
  it("[UNIT] the FX week closes Friday 21:00 UTC and reopens Sunday 21:00 UTC", () => {
    expect(isWeekendClosed(at("2026-08-21T20:59:00Z"))).toBe(false); // Friday
    expect(isWeekendClosed(at("2026-08-21T21:00:00Z"))).toBe(true);
    expect(isWeekendClosed(at("2026-08-22T12:00:00Z"))).toBe(true); // Saturday
    expect(isWeekendClosed(at("2026-08-23T20:59:00Z"))).toBe(true); // Sunday, pre-open
    expect(isWeekendClosed(at("2026-08-23T21:00:00Z"))).toBe(false);
  });
});

describe("marketStatus", () => {
  it("[UNIT] during the London/NY overlap both those sessions are open", () => {
    const s = marketStatus(at("2026-08-20T14:00:00Z"));
    expect(s.weekendClosed).toBe(false);
    expect(s.minutesToReopen).toBeNull();
    const open = s.sessions.filter((x) => x.open).map((x) => x.key).sort();
    expect(open).toEqual(["london", "new_york"]);
    expect(s.openCount).toBe(2);
    expect(s.scannerSession).toBe("london_new_york_overlap");
  });

  it("[UNIT] a wrap-around window (Sydney) is recognised as open after midnight-crossing", () => {
    const s = marketStatus(at("2026-08-20T23:00:00Z"));
    expect(s.sessions.find((x) => x.key === "sydney")!.open).toBe(true);
  });

  it("[INVARIANT] the weekend reports every session closed and a positive reopen countdown", () => {
    const s = marketStatus(at("2026-08-22T12:00:00Z"));
    expect(s.weekendClosed).toBe(true);
    expect(s.openCount).toBe(0);
    expect(s.minutesToReopen!).toBeGreaterThan(0);
    expect(Number.isFinite(s.minutesToReopen!)).toBe(true);
  });

  it("[INVARIANT] minutesToChange is always a positive finite integer", () => {
    for (let h = 0; h < 24; h += 1) {
      const s = marketStatus(at(`2026-08-20T${String(h).padStart(2, "0")}:00:00Z`));
      for (const sess of s.sessions) {
        expect(sess.minutesToChange).toBeGreaterThan(0);
        expect(Number.isInteger(sess.minutesToChange)).toBe(true);
      }
    }
  });
});

describe("formatDuration", () => {
  it("[UNIT] renders minutes, hours and days without NaN", () => {
    expect(formatDuration(5)).toBe("5m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(95)).toBe("1h 35m");
    expect(formatDuration(60 * 26)).toBe("1d 2h");
  });
});
