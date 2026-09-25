import { describe, expect, it } from "vitest";
import { findDiscrepancies } from "../discrepancies";

const base = {
  deliveries: [{ id: 1, client_id: "PT_a_1", broker_order_id: "99", broker_symbol: "EURUSD", account_mode: "live_auto" }],
  brokerStateByDelivery: new Map<number, string>([[1, "open"]]),
  ownedDealClientIds: ["PT_a_1"],
  positions: [],
  isPTradesClientId: (c: string | null | undefined) => !!c?.startsWith("PT_"),
  balance: null,
};

describe("[UNIT] reconciliation discrepancies", () => {
  it("[UNIT] flags nothing when both sides agree", () => {
    expect(findDiscrepancies(base)).toEqual([]);
  });
  it("[UNIT] flags an order the broker has no trace of, critical on live", () => {
    const r = findDiscrepancies({ ...base, brokerStateByDelivery: new Map([[1, "absent"]]) });
    expect(r[0]).toMatchObject({ kind: "order_missing_at_broker", severity: "critical" });
  });
  it("[UNIT] flags unmatched fills and untracked positions, ignores manual trades", () => {
    const r = findDiscrepancies({
      ...base,
      ownedDealClientIds: ["PT_a_1", "PT_b_2"],
      positions: [{ id: "7", clientId: "PT_c_3" }, { id: "8", clientId: "manual" }],
    });
    expect(r.map((d) => d.kind).sort()).toEqual(["broker_fill_unmatched", "position_untracked"]);
  });
  it("[UNIT] flags balance drift beyond tolerance only when history covers the gap", () => {
    const balance = {
      stored: 1000, storedAt: "2026-09-01T00:00:00Z", broker: 1100, currency: "USD",
      dealsSince: [{ profit: 50 }], historyCovers: true,
    };
    expect(findDiscrepancies({ ...base, balance })[0]?.kind).toBe("balance_drift");
    expect(findDiscrepancies({ ...base, balance: { ...balance, dealsSince: [{ profit: 100 }] } })).toEqual([]);
    expect(findDiscrepancies({ ...base, balance: { ...balance, historyCovers: false } })).toEqual([]);
  });
});
