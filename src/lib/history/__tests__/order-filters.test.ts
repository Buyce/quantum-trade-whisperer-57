import { describe, expect, it } from "vitest";

import type { BrokerOrderView } from "../broker-orders";
import {
  EMPTY_ORDER_FILTERS,
  filterBrokerOrders,
  gradesInRows,
  instrumentsInRows,
  netByCurrency,
  orderFiltersActive,
  orderResultClass,
} from "../order-filters";

function view(overrides: Partial<BrokerOrderView> = {}): BrokerOrderView {
  return {
    key: overrides.key ?? "k",
    deliveryId: 1,
    instrument: "EURUSD",
    grade: "A",
    direction: "short",
    detectedAt: null,
    enqueuedAt: "2026-08-27T10:00:00.000Z",
    accountType: "demo",
    destination: { kind: "broker_account", label: "Connected broker account" },
    dryRun: false,
    entryMode: "market",
    status: { kind: "closed_at_broker", label: "Closed at the broker", detail: null },
    submitted: { volume: 1, entry: 1.1, stop: 1.11, target: 1.09, at: null, brokerSymbol: "EURUSD" },
    broker: {
      state: "closed",
      entryPrice: 1.1,
      exitPrice: 1.09,
      volume: 1,
      entryAt: null,
      exitAt: null,
      grossProfit: 100,
      commission: 0,
      swap: -2,
      currency: "EUR",
      netProfit: 98,
      slippage: { price: 0.0001, availability: "available", basis: "submitted", reference: 1.1 },
    },
    r: { value: 1, basis: "actual_risk", provenance: "broker", label: "R", reason: null } as never,
    plan: { entry: null, stop: null, target: null, rr: null },
    recovered: false,
    ...overrides,
  };
}

describe("order filters", () => {
  it("classifies results from broker money only", () => {
    expect(orderResultClass(view())).toBe("winner");
    expect(orderResultClass(view({ broker: { ...view().broker!, netProfit: -5 } }))).toBe("loser");
    expect(orderResultClass(view({ broker: { ...view().broker!, netProfit: 0 } }))).toBe(
      "breakeven",
    );
    expect(orderResultClass(view({ broker: null }))).toBe("not_filled");
    expect(
      orderResultClass(
        view({ status: { kind: "open_at_broker", label: "Open at the broker", detail: null } }),
      ),
    ).toBe("open");
  });

  it("returns everything when no filter is set", () => {
    const rows = [view({ key: "a" }), view({ key: "b", instrument: "XAUUSD" })];
    expect(filterBrokerOrders(rows, EMPTY_ORDER_FILTERS)).toHaveLength(2);
    expect(orderFiltersActive(EMPTY_ORDER_FILTERS)).toBe(false);
  });

  it("filters by instrument, grade and result", () => {
    const rows = [
      view({ key: "a" }),
      view({ key: "b", instrument: "XAUUSD", grade: "B" }),
      view({ key: "c", broker: null, status: { kind: "not_sent", label: "Not sent", detail: null } }),
    ];
    expect(
      filterBrokerOrders(rows, { ...EMPTY_ORDER_FILTERS, instruments: ["XAUUSD"] }).map((r) => r.key),
    ).toEqual(["b"]);
    expect(filterBrokerOrders(rows, { ...EMPTY_ORDER_FILTERS, grades: ["B"] })).toHaveLength(1);
    expect(
      filterBrokerOrders(rows, { ...EMPTY_ORDER_FILTERS, result: "not_filled" }).map((r) => r.key),
    ).toEqual(["c"]);
  });

  it("excludes unpriced rows from a money range instead of treating them as zero", () => {
    const rows = [view({ key: "a" }), view({ key: "b", broker: null })];
    expect(filterBrokerOrders(rows, { ...EMPTY_ORDER_FILTERS, minNet: 0 }).map((r) => r.key)).toEqual(
      ["a"],
    );
    expect(filterBrokerOrders(rows, { ...EMPTY_ORDER_FILTERS, maxNet: 10 })).toHaveLength(0);
  });

  it("lists instruments and grades present, and sums money per currency", () => {
    const rows = [
      view({ key: "a" }),
      view({ key: "b", instrument: "XAUUSD", grade: "Unknown" }),
      view({
        key: "c",
        broker: { ...view().broker!, currency: "USD", netProfit: -10 },
      }),
    ];
    expect(instrumentsInRows(rows)).toEqual(["EURUSD", "XAUUSD"]);
    expect(gradesInRows(rows)).toEqual(["A", "Unknown"]);
    expect(netByCurrency(rows)).toEqual([
      { currency: "EUR", net: 196, count: 2 },
      { currency: "USD", net: -10, count: 1 },
    ]);
  });
});
