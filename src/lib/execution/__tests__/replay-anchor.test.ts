/**
 * Historical anchoring — a candidate detected days ago must be adjudicated
 * against the bars that actually followed it, never against the live tail.
 */
import { describe, expect, it } from "vitest";

import { anchorForRows, windowCoversRow } from "../replay-anchor";

const HOUR = 3_600_000;
const now = Date.parse("2026-09-05T12:00:00.000Z");

describe("anchorForRows", () => {
  it("[UNIT] reads the live tail when the oldest row is recent", () => {
    const anchor = anchorForRows(
      [{ detected_at: new Date(now - 2 * HOUR).toISOString(), replay_cursor: null }],
      200,
      now,
    );
    expect(anchor.startTime).toBeNull();
  });

  it("[INVARIANT] anchors a past window on the oldest waiting row", () => {
    const oldest = new Date(now - 240 * HOUR).toISOString();
    const anchor = anchorForRows(
      [
        { detected_at: new Date(now - 3 * HOUR).toISOString(), replay_cursor: null },
        { detected_at: oldest, replay_cursor: null },
      ],
      200,
      now,
    );
    expect(anchor.oldestStart).toBe(oldest);
    expect(anchor.startTime).not.toBeNull();
    const anchorMs = Date.parse(anchor.startTime as string);
    // The window starts at the oldest row and runs forward, never past now.
    expect(anchorMs).toBeGreaterThan(Date.parse(oldest));
    expect(anchorMs).toBeLessThan(now);
    expect((anchorMs - Date.parse(oldest)) / 900_000).toBeCloseTo(198, 6);
  });

  it("[UNIT] prefers the replay cursor over detection time", () => {
    const anchor = anchorForRows(
      [
        {
          detected_at: new Date(now - 300 * HOUR).toISOString(),
          replay_cursor: new Date(now - 2 * HOUR).toISOString(),
        },
      ],
      200,
      now,
    );
    expect(anchor.startTime).toBeNull();
  });

  it("[UNIT] an unreadable start point yields no anchor", () => {
    const anchor = anchorForRows([{ detected_at: "not-a-date", replay_cursor: null }], 200, now);
    expect(anchor.startTime).toBeNull();
    expect(anchor.oldestStart).toBeNull();
  });
});

describe("windowCoversRow", () => {
  const candles = [{ time: "2026-08-27T00:00:00.000Z" }, { time: "2026-08-27T02:00:00.000Z" }];

  it("[UNIT] covers a row that starts inside the window", () => {
    expect(
      windowCoversRow({ detected_at: "2026-08-27T01:00:00.000Z", replay_cursor: null }, candles),
    ).toBe(true);
  });

  it("[INVARIANT] does not claim to cover a row later than the window", () => {
    expect(
      windowCoversRow({ detected_at: "2026-09-01T00:00:00.000Z", replay_cursor: null }, candles),
    ).toBe(false);
  });

  it("[INVARIANT] an empty window covers nothing", () => {
    expect(
      windowCoversRow({ detected_at: "2026-08-27T01:00:00.000Z", replay_cursor: null }, []),
    ).toBe(false);
  });
});
