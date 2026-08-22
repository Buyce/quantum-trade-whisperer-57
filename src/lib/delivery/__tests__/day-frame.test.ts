/**
 * Prompt 10 — the daily-cap authority must be the COMPLETE UTC-day frame.
 *
 * The regression that matters: on a day with more than the feed's 400-row
 * display window, the feed and the server must still agree on which signals are
 * inside the cap. Both call `fetchDayFrame` + `buildCapFrame`, so the test proves
 * pagination completes AND that a truncated window would have given a different
 * (wrong) answer.
 */
import { describe, expect, it } from "vitest";
import { fetchDayFrame, toEligibilitySignal, type FrameClient } from "../day-frame";
import { buildCapFrame, type EligibilitySettings } from "../eligibility";
import type { Grade } from "@/lib/db-types";

const NOW = new Date("2026-08-22T23:00:00.000Z").getTime();

interface Row {
  id: string;
  detected_at: string;
  instrument: string;
  grade: Grade;
  market_context: { trading_session: string }[];
}

/** 1200 graded signals, two minutes apart, all inside the same UTC day. */
function buildRows(count: number): Row[] {
  const base = new Date("2026-08-22T00:00:00.000Z").getTime();
  return Array.from({ length: count }, (_, i) => ({
    id: `s${String(i).padStart(5, "0")}`,
    detected_at: new Date(base + i * 60_000).toISOString(),
    instrument: "XAUUSD",
    grade: "A" as Grade,
    market_context: [{ trading_session: "london" }],
  }));
}

function fakeClient(rows: Row[], calls: { pages: number }): FrameClient {
  return {
    from: () => ({
      select: () => ({
        gte: (_column: string, value: string) => ({
          order: () => ({
            range: async (from: number, to: number) => {
              calls.pages += 1;
              const inDay = rows.filter((r) => r.detected_at >= value);
              return { data: inDay.slice(from, to + 1), error: null };
            },
          }),
        }),
      }),
    }),
  } as unknown as FrameClient;
}

const settings: EligibilitySettings = {
  instruments: [],
  sessions: [],
  min_grade: "C",
  alert_min_grade: "C",
  daily_setup_cap: 5,
};

describe("fetchDayFrame", () => {
  it("[UNIT] pages past 400 and past 1000 rows to completion", async () => {
    const rows = buildRows(1200);
    const calls = { pages: 0 };
    const frame = await fetchDayFrame(fakeClient(rows, calls), NOW);
    expect(frame).toHaveLength(1200);
    expect(calls.pages).toBe(2);
    expect(frame[0]!.trading_session).toBe("london");
  });

  it("[INVARIANT] feed and server agree on the in-cap set on a >400-signal day", async () => {
    const rows = buildRows(1200);
    // Server path: the complete frame.
    const serverFrame = await fetchDayFrame(fakeClient(rows, { pages: 0 }), NOW);
    // Client path: the same helper, same query, same pure cap function.
    const clientFrame = await fetchDayFrame(fakeClient(rows, { pages: 0 }), NOW);

    const serverCapped = buildCapFrame(serverFrame, settings, "feed", NOW);
    const clientCapped = buildCapFrame(clientFrame, settings, "feed", NOW);
    expect([...clientCapped].sort()).toEqual([...serverCapped].sort());
    expect(serverCapped.size).toBe(1200 - 5);
    // The in-cap set is the day's FIRST five, not the newest five.
    for (const id of ["s00000", "s00001", "s00002", "s00003", "s00004"]) {
      expect(serverCapped.has(id)).toBe(false);
    }

    // A truncated 400-row display window would have produced a different answer,
    // which is exactly why the display query cannot be the cap authority.
    const truncated = buildCapFrame(serverFrame.slice(-400), settings, "feed", NOW);
    expect(truncated.has("s00800")).toBe(false);
    expect(serverCapped.has("s00800")).toBe(true);
  });

  it("[INVARIANT] throws rather than treating a partial read as a complete frame", async () => {
    const failing = {
      from: () => ({
        select: () => ({
          gte: () => ({
            order: () => ({
              range: async () => ({ data: null, error: { message: "read failed" } }),
            }),
          }),
        }),
      }),
    } as unknown as FrameClient;
    await expect(fetchDayFrame(failing, NOW)).rejects.toThrow("read failed");
  });
});

describe("toEligibilitySignal", () => {
  it("[UNIT] normalises an embedded market_context array and a missing context", () => {
    const withCtx = toEligibilitySignal({
      id: "a",
      detected_at: "2026-08-22T01:00:00.000Z",
      instrument: "XAUUSD",
      grade: "A",
      market_context: [
        { trading_session: "tokyo", volatility_index: 1, time_of_day: 1, day_of_week: 6 },
      ],
    } as never);
    expect(withCtx.trading_session).toBe("tokyo");

    const without = toEligibilitySignal({
      id: "b",
      detected_at: "2026-08-22T01:00:00.000Z",
      instrument: "XAUUSD",
      grade: "A",
      market_context: null,
    } as never);
    expect(without.trading_session).toBeNull();
  });
});
