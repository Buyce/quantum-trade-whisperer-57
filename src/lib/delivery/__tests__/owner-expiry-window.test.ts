import { describe, expect, it } from "vitest";

import { isUnfilledTooLong, ownerTimeoutMs } from "@/lib/delivery/expire-unfilled.server";
import { UNFILLED_ORDER_TIMEOUT_MS } from "@/lib/delivery/execution";

describe("unfilled-order sweep uses the owner's own automatic-order window", () => {
  it("[UNIT] the owner's window in minutes becomes the timeout", () => {
    expect(ownerTimeoutMs(180)).toBe(180 * 60_000);
  });

  it("[INVARIANT] missing, zero or unreadable windows fall back to the fixed timeout", () => {
    for (const value of [null, undefined, 0, -5, Number.NaN]) {
      expect(ownerTimeoutMs(value as number | null)).toBe(UNFILLED_ORDER_TIMEOUT_MS);
    }
  });

  it("[INVARIANT] the window can never exceed the six-hour maximum", () => {
    expect(ownerTimeoutMs(99999)).toBe(360 * 60_000);
  });

  it("[UNIT] a three-hour owner keeps their order past one hour and loses it after three", () => {
    const now = Date.parse("2026-08-26T12:00:00Z");
    const row = { enqueued_at: "2026-08-26T10:00:00Z", sent_at: null };
    expect(isUnfilledTooLong(row, now, ownerTimeoutMs(180))).toBe(false);
    expect(isUnfilledTooLong(row, now, ownerTimeoutMs(60))).toBe(true);
    expect(
      isUnfilledTooLong(
        { enqueued_at: "2026-08-26T08:30:00Z", sent_at: null },
        now,
        ownerTimeoutMs(180),
      ),
    ).toBe(true);
  });
});
