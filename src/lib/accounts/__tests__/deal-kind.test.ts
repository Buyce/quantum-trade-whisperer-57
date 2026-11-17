import { describe, expect, it } from "vitest";
import { isNonTradingDeal, isPTradesDeal } from "@/lib/accounts/deal-kind";

describe("account daily P&L deal filter", () => {
  it("[INVARIANT] a deposit is not counted as trading profit", () => {
    expect(isNonTradingDeal({ type: "DEAL_TYPE_BALANCE" })).toBe(true);
  });
  it("[INVARIANT] a closed buy or sell deal still counts", () => {
    expect(isNonTradingDeal({ type: "DEAL_TYPE_SELL" })).toBe(false);
    expect(isNonTradingDeal({ type: "DEAL_TYPE_BUY" })).toBe(false);
  });
  it("[INVARIANT] only deals tagged by P-Trades count as P-Trades profit", () => {
    expect(isPTradesDeal({ clientId: "PT_abc_9" }, null)).toBe(true);
    expect(isPTradesDeal({ clientId: null }, null)).toBe(false);
    expect(isPTradesDeal({ clientId: "PT_abc_9", magic: 7 }, 8)).toBe(false);
  });
});
