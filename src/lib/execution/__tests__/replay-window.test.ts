import { describe, expect, it } from "vitest";
import {
  barsRequiredForRow,
  classifyReplayWindow,
  M15_BAR_MS,
  OUTSIDE_REPLAY_WINDOW,
} from "@/lib/execution/replay-window";

const now = Date.parse("2026-09-03T04:00:00.000Z");

describe("barsRequiredForRow", () => {
  it("[UNIT] counts bars from the replay cursor when one exists", () => {
    const row = {
      detected_at: new Date(now - 100 * M15_BAR_MS).toISOString(),
      replay_cursor: new Date(now - 10 * M15_BAR_MS).toISOString(),
    };
    expect(barsRequiredForRow(row, now)).toBe(12);
  });

  it("[UNIT] falls back to detection time when there is no cursor", () => {
    const row = {
      detected_at: new Date(now - 20 * M15_BAR_MS).toISOString(),
      replay_cursor: null,
    };
    expect(barsRequiredForRow(row, now)).toBe(22);
  });

  it("[UNIT] returns null for an unreadable start point rather than a number", () => {
    expect(barsRequiredForRow({ detected_at: "not a date", replay_cursor: null }, now)).toBeNull();
  });
});

describe("classifyReplayWindow", () => {
  it("[UNIT] labels a row that needs more history than the cap allows", () => {
    const row = {
      detected_at: new Date(now - 900 * M15_BAR_MS).toISOString(),
      replay_cursor: null,
    };
    expect(classifyReplayWindow(row, 200, now)).toBe(OUTSIDE_REPLAY_WINDOW);
  });

  it("[UNIT] leaves a row inside the window unlabelled", () => {
    const row = {
      detected_at: new Date(now - 50 * M15_BAR_MS).toISOString(),
      replay_cursor: null,
    };
    expect(classifyReplayWindow(row, 200, now)).toBeNull();
  });

  it("[UNIT] does not label an exactly-at-cap row", () => {
    const row = {
      detected_at: new Date(now - 198 * M15_BAR_MS).toISOString(),
      replay_cursor: null,
    };
    expect(classifyReplayWindow(row, 200, now)).toBeNull();
  });

  it("[UNIT] never labels a row whose start point could not be read", () => {
    expect(classifyReplayWindow({ detected_at: "", replay_cursor: null }, 200, now)).toBeNull();
  });
});
