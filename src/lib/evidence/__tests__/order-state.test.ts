import { describe, expect, it } from "vitest";

import {
  neverReachedBroker,
  occupiesSlot,
  resolveBrokerOrderState,
  type BrokerOrderView,
} from "@/lib/evidence/order-state";

function view(overrides: Partial<BrokerOrderView> = {}): BrokerOrderView {
  return {
    brokerOrderId: "12345",
    evidenceState: null,
    restingOrderIds: [],
    positionIds: [],
    historyOrderStates: new Map(),
    brokerReadable: true,
    ...overrides,
  };
}

describe("broker order lifecycle", () => {
  it("[INVARIANT] matched closed evidence is closed, and frees the slot", () => {
    const state = resolveBrokerOrderState(view({ evidenceState: "closed" }));
    expect(state).toBe("closed");
    expect(occupiesSlot(state)).toBe(false);
  });

  it("[INVARIANT] an entry-only open position is open, and keeps its slot", () => {
    const state = resolveBrokerOrderState(view({ evidenceState: "open" }));
    expect(state).toBe("open");
    expect(occupiesSlot(state)).toBe(true);
  });

  it("[INVARIANT] a broker-listed pending order is resting", () => {
    expect(resolveBrokerOrderState(view({ restingOrderIds: ["12345"] }))).toBe("resting");
  });

  it("[INVARIANT] an existing position wins over a stale pending listing", () => {
    expect(
      resolveBrokerOrderState(view({ positionIds: ["12345"], restingOrderIds: ["12345"] })),
    ).toBe("open");
  });

  it("[INVARIANT] a broker-cancelled order frees the slot", () => {
    const state = resolveBrokerOrderState(
      view({ historyOrderStates: new Map([["12345", "ORDER_STATE_CANCELED"]]) }),
    );
    expect(state).toBe("cancelled");
    expect(occupiesSlot(state)).toBe(false);
  });

  it("[INVARIANT] a filled history order without evidence stays unresolved, never closed", () => {
    const state = resolveBrokerOrderState(
      view({ historyOrderStates: new Map([["12345", "ORDER_STATE_FILLED"]]) }),
    );
    expect(state).toBe("unresolved");
    expect(occupiesSlot(state)).toBe(true);
  });

  it("[INVARIANT] a readable broker that lists the order nowhere makes it absent", () => {
    const state = resolveBrokerOrderState(view());
    expect(state).toBe("absent");
    expect(occupiesSlot(state)).toBe(false);
  });

  it("[INVARIANT] an unreadable broker never frees a slot", () => {
    const state = resolveBrokerOrderState(view({ brokerReadable: false }));
    expect(state).toBe("unresolved");
    expect(occupiesSlot(state)).toBe(true);
  });

  it("[INVARIANT] no recorded broker order id is unresolved, not absent", () => {
    expect(resolveBrokerOrderState(view({ brokerOrderId: null }))).toBe("unresolved");
  });

  it("[INVARIANT] a never-observed order fails closed and keeps its slot", () => {
    expect(occupiesSlot(null)).toBe(true);
  });
});

describe("deliveries with no broker reference", () => {
  it("[INVARIANT] stays unresolved while the broker still mentions the clientId", () => {
    expect(resolveBrokerOrderState(view({ brokerOrderId: null, clientIdSeenAtBroker: true }))).toBe(
      "unresolved",
    );
  });

  it("[INVARIANT] resolves to absent once a fully readable broker mentions it nowhere", () => {
    const state = resolveBrokerOrderState(
      view({ brokerOrderId: null, clientIdSeenAtBroker: false }),
    );
    expect(state).toBe("absent");
    expect(occupiesSlot(state)).toBe(false);
  });

  it("[INVARIANT] an unreadable broker never yields absent", () => {
    expect(
      resolveBrokerOrderState(
        view({ brokerOrderId: null, clientIdSeenAtBroker: false, brokerReadable: false }),
      ),
    ).toBe("unresolved");
  });

  it("[INVARIANT] omitting the clientId observation fails closed", () => {
    expect(resolveBrokerOrderState(view({ brokerOrderId: null }))).toBe("unresolved");
  });
});

describe("neverReachedBroker", () => {
  it("[INVARIANT] only an attempt with no submission, clientId or order id is provably unsent", () => {
    expect(neverReachedBroker({ submittedAt: null, clientId: null, brokerOrderId: null })).toBe(
      true,
    );
    expect(
      neverReachedBroker({
        submittedAt: "2026-08-31T00:00:00Z",
        clientId: null,
        brokerOrderId: null,
      }),
    ).toBe(false);
    expect(neverReachedBroker({ submittedAt: null, clientId: "PT-1", brokerOrderId: null })).toBe(
      false,
    );
    expect(neverReachedBroker({ submittedAt: null, clientId: null, brokerOrderId: "9" })).toBe(
      false,
    );
  });
});
