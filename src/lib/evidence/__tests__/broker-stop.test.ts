import { describe, expect, it } from "vitest";

import { resolveBrokerStop } from "../associate";

const group = {
  clientId: "PT_abc",
  brokerOrderId: "o1",
  brokerPositionId: "p1",
  basis: "client_id",
  magic: 1,
  symbol: "XAUUSD",
  deals: [],
} as never;

describe("broker stop provenance", () => {
  it("[INVARIANT] prefers the stop the broker holds on the open position", () => {
    expect(resolveBrokerStop(group, [{ id: "p1", clientId: "PT_abc", stopLoss: 1.5 }], [])).toEqual(
      {
        stop: 1.5,
        source: "broker_position",
      },
    );
  });

  it("[INVARIANT] falls back to the opening order, still broker-reported", () => {
    expect(
      resolveBrokerStop(
        group,
        [],
        [{ id: "o1", positionId: "p1", clientId: "PT_abc", stopLoss: 2 }],
      ),
    ).toEqual({ stop: 2, source: "broker_order" });
  });

  it("[INVARIANT] a broker with no stop attached yields null, never the requested stop", () => {
    expect(
      resolveBrokerStop(group, [{ id: "p1", clientId: "PT_abc", stopLoss: null }], []),
    ).toEqual({
      stop: null,
      source: "broker_reported_none",
    });
  });

  it("[INVARIANT] nothing matched is unknown, not invented", () => {
    expect(resolveBrokerStop(group, [], [])).toEqual({ stop: null, source: "unknown" });
  });
});
