/**
 * Guards the unfilled-order sweeper. Its whole reason to exist is freeing a slot
 * WITHOUT ever claiming a broker outcome, so every invariant here is about what
 * it refuses to do.
 */
import { describe, expect, it } from "vitest";

import {
  CONCURRENT_ORDER_CEILING_MAX,
  DAILY_ORDER_CEILING_MAX,
  PER_SYMBOL_ORDER_CEILING_MAX,
  clampConcurrentOrderCeiling,
  clampDailyOrderCeiling,
  clampPerSymbolOrderCeiling,
} from "@/lib/db-types";
import { UNFILLED_ORDER_TIMEOUT_MS, isTerminal } from "@/lib/delivery/execution";
import {
  classifyBrokerPresence,
  isUnfilledTooLong,
  neverSubmitted,
} from "@/lib/delivery/expire-unfilled.server";

const now = Date.parse("2026-08-26T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("unfilled-order timeout", () => {
  it("[INVARIANT] a young order is never swept", () => {
    expect(isUnfilledTooLong({ enqueued_at: ago(10 * 60_000), sent_at: null }, now)).toBe(false);
  });

  it("[INVARIANT] the wait is measured from the submission when there is one", () => {
    expect(
      isUnfilledTooLong({ enqueued_at: ago(5 * 60 * 60_000), sent_at: ago(60_000) }, now),
    ).toBe(false);
    expect(
      isUnfilledTooLong({ enqueued_at: ago(5 * 60 * 60_000), sent_at: ago(2 * 60 * 60_000) }, now),
    ).toBe(true);
  });

  it("[INVARIANT] an unreadable timestamp never expires a row", () => {
    expect(isUnfilledTooLong({ enqueued_at: null, sent_at: null }, now)).toBe(false);
    expect(isUnfilledTooLong({ enqueued_at: "not a date", sent_at: null }, now)).toBe(false);
  });

  it("[INVARIANT] the timeout is a real bounded hour", () => {
    expect(UNFILLED_ORDER_TIMEOUT_MS).toBe(60 * 60_000);
  });
});

describe("submission proof", () => {
  it("[INVARIANT] only a row with no trace of a submission may be cleared without the broker", () => {
    expect(
      neverSubmitted({
        state: "pending",
        submitted_at: null,
        broker_order_id: null,
        sent_at: null,
      }),
    ).toBe(true);
    for (const hint of [
      { submitted_at: ago(1), broker_order_id: null, sent_at: null },
      { submitted_at: null, broker_order_id: "12345", sent_at: null },
      { submitted_at: null, broker_order_id: null, sent_at: ago(1) },
    ]) {
      expect(neverSubmitted({ state: "claimed", ...hint })).toBe(false);
    }
  });

  it("[INVARIANT] a sent or acknowledged row is never treated as unsubmitted", () => {
    for (const state of ["sent", "acknowledged"] as const) {
      expect(
        neverSubmitted({ state, submitted_at: null, broker_order_id: null, sent_at: null }),
      ).toBe(false);
    }
  });

  it("[INVARIANT] an unknown retry row that never reached a broker is reclaimable", () => {
    expect(
      neverSubmitted({
        state: "unknown",
        submitted_at: null,
        broker_order_id: null,
        sent_at: null,
      }),
    ).toBe(true);
    // Any trace of a broker round trip keeps the row off the reclaim path.
    expect(
      neverSubmitted({
        state: "unknown",
        submitted_at: null,
        broker_order_id: "12345",
        sent_at: null,
      }),
    ).toBe(false);
  });
});


describe("broker presence", () => {
  it("[INVARIANT] a filled order is never cancellable", () => {
    expect(classifyBrokerPresence("1", [], [{ id: "1" }])).toBe("filled");
  });

  it("[INVARIANT] a partially filled pending order counts as filled", () => {
    expect(classifyBrokerPresence("1", [{ id: "1", volume: 1, currentVolume: 0.4 }], [])).toBe(
      "filled",
    );
  });

  it("[INVARIANT] an untouched resting order is cancellable", () => {
    expect(classifyBrokerPresence("1", [{ id: "1", volume: 1, currentVolume: 1 }], [])).toBe(
      "resting",
    );
  });

  it("[INVARIANT] an order the broker does not list is not cancellable", () => {
    expect(classifyBrokerPresence("1", [{ id: "2" }], [{ id: "3" }])).toBe("absent");
  });
});

describe("expired state", () => {
  it("[INVARIANT] expired is terminal, so it frees the concurrent slot", () => {
    expect(isTerminal("expired")).toBe(true);
  });
});

describe("raised ceilings", () => {
  it("[INVARIANT] every automatic-order ceiling may now be configured up to 100", () => {
    expect(CONCURRENT_ORDER_CEILING_MAX).toBe(100);
    expect(DAILY_ORDER_CEILING_MAX).toBe(100);
    expect(PER_SYMBOL_ORDER_CEILING_MAX).toBe(100);
    expect(clampConcurrentOrderCeiling(1000)).toBe(100);
    expect(clampDailyOrderCeiling(1000)).toBe(100);
    expect(clampPerSymbolOrderCeiling(1000)).toBe(100);
  });

  it("[INVARIANT] defaults are unchanged and zero still means off", () => {
    expect(clampConcurrentOrderCeiling(null)).toBe(3);
    expect(clampDailyOrderCeiling(null)).toBe(10);
    expect(clampConcurrentOrderCeiling(0)).toBe(0);
  });
});
