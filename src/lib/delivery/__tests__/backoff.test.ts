import { describe, expect, it } from "vitest";

import {
  BACKOFF_CEILING_SECONDS,
  backoffSeconds,
  nextAttemptAt,
  retryWorthKeeping,
} from "../backoff";

describe("[UNIT] delivery/backoff", () => {
  it("[UNIT] waits one minute after the first refusal and grows from there", () => {
    expect(backoffSeconds("quote_unavailable", 1)).toBe(60);
    expect(backoffSeconds("quote_unavailable", 2)).toBe(120);
    expect(backoffSeconds("quote_unavailable", 3)).toBe(240);
  });

  it("[UNIT] reads the bare reason out of a reason carrying a detail", () => {
    expect(backoffSeconds("market_closed: session ended", 1)).toBe(600);
  });
});

describe("[INVARIANT] delivery/backoff never re-asks faster than the schedule", () => {
  it("[INVARIANT] is never below one minute and never above the ceiling", () => {
    for (const attempts of [0, 1, 2, 5, 17, 84, 500]) {
      const seconds = backoffSeconds("price_beyond_max_acceptable_entry", attempts);
      expect(seconds).toBeGreaterThanOrEqual(60);
      expect(seconds).toBeLessThanOrEqual(BACKOFF_CEILING_SECONDS);
    }
  });

  it("[INVARIANT] a hot row that already burned 84 attempts waits the full ceiling", () => {
    expect(backoffSeconds("price_beyond_max_acceptable_entry", 84)).toBe(BACKOFF_CEILING_SECONDS);
  });

  it("[INVARIANT] a closed market is never re-asked on a minute scale", () => {
    expect(backoffSeconds("market_closed", 1)).toBeGreaterThanOrEqual(600);
  });

  it("[INVARIANT] schedules forward from the given instant only", () => {
    const now = new Date("2026-09-01T10:00:00.000Z");
    expect(nextAttemptAt("quote_stale", 1, now).toISOString()).toBe("2026-09-01T10:01:00.000Z");
  });

  it("[INVARIANT] refuses to park a retry that would land past the owner's window", () => {
    const next = new Date("2026-09-01T10:10:00.000Z");
    expect(retryWorthKeeping(next, new Date("2026-09-01T10:05:00.000Z"))).toBe(false);
    expect(retryWorthKeeping(next, new Date("2026-09-01T11:00:00.000Z"))).toBe(true);
    expect(retryWorthKeeping(next, null)).toBe(true);
  });
});
