import { describe, expect, it } from "vitest";

import {
  findDuplicateOrder,
  isSameOrderPlan,
  type RestingOrder,
} from "@/lib/delivery/duplicate-orders";

function held(partial: Partial<RestingOrder>): RestingOrder {
  return {
    deliveryId: 1,
    signalId: "held-signal",
    instrument: "EURUSD",
    direction: "short",
    entry: 1.16544,
    ...partial,
  };
}

describe("one live automatic order per setup", () => {
  it("[UNIT] treats entries within one broker tick as the same order", () => {
    expect(
      isSameOrderPlan(
        { instrument: "EURUSD", direction: "short", entry: 1.16545 },
        held({}),
        0.00001,
      ),
    ).toBe(true);
  });

  it("[UNIT] a different price, direction or instrument is not a duplicate", () => {
    const tick = 0.00001;
    expect(
      isSameOrderPlan({ instrument: "EURUSD", direction: "short", entry: 1.167 }, held({}), tick),
    ).toBe(false);
    expect(
      isSameOrderPlan({ instrument: "EURUSD", direction: "long", entry: 1.16544 }, held({}), tick),
    ).toBe(false);
    expect(
      isSameOrderPlan({ instrument: "XAUUSD", direction: "short", entry: 1.16544 }, held({}), tick),
    ).toBe(false);
  });

  it("[INVARIANT] unreadable plan data is never called a duplicate", () => {
    expect(
      isSameOrderPlan({ instrument: "EURUSD", direction: "short", entry: null }, held({}), 0.00001),
    ).toBe(false);
    expect(
      isSameOrderPlan(
        { instrument: "EURUSD", direction: null, entry: 1.16544 },
        held({}),
        0.00001,
      ),
    ).toBe(false);
    expect(
      isSameOrderPlan(
        { instrument: "EURUSD", direction: "short", entry: 1.16544 },
        held({ entry: null }),
        0.00001,
      ),
    ).toBe(false);
  });

  it("[UNIT] an unknown tick falls back to exact equality only", () => {
    expect(
      isSameOrderPlan({ instrument: "EURUSD", direction: "short", entry: 1.16545 }, held({}), null),
    ).toBe(false);
    expect(
      isSameOrderPlan({ instrument: "EURUSD", direction: "short", entry: 1.16544 }, held({}), null),
    ).toBe(true);
  });

  it("[BEHAVIOUR] a republished structure is refused, and a signal never blocks itself", () => {
    const candidate = {
      instrument: "EURUSD",
      direction: "short",
      entry: 1.16544,
      signalId: "new-signal",
    };
    expect(findDuplicateOrder(candidate, [held({ deliveryId: 42 })], 0.00001)?.deliveryId).toBe(42);
    expect(
      findDuplicateOrder(candidate, [held({ signalId: "new-signal" })], 0.00001),
    ).toBeNull();
    expect(findDuplicateOrder(candidate, [], 0.00001)).toBeNull();
  });
});
