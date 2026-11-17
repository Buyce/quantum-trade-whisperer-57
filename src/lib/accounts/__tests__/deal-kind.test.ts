import { describe, expect, it } from "vitest";
import { isNonTradingDeal } from "@/lib/accounts/deal-kind";

describe("account daily P&L deal filter", () => {
  it("[INVARIANT] a deposit is not counted as trading profit", () => {
    expect(isNonTradingDeal({ type: "DEAL_TYPE_BALANCE" })).toBe(true);
  });
  it("[INVARIANT] a closed buy or sell deal still counts", () => {
    expect(isNonTradingDeal({ type: "DEAL_TYPE_SELL" })).toBe(false);
    expect(isNonTradingDeal({ type: "DEAL_TYPE_BUY" })).toBe(false);
  });
});
