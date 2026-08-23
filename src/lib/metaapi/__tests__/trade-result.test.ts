import { describe, expect, it } from "vitest";
import { interpretTradeResponse } from "../trade-result";

describe("trade response interpretation", () => {
  it("[UNIT] recognises broker acceptance codes", () => {
    for (const numericCode of [0, 10008, 10009, 10010]) {
      const verdict = interpretTradeResponse({ numericCode, orderId: "1" });
      expect(verdict.outcome).toBe("accepted");
      expect(verdict.safeToResubmit).toBe(false);
    }
  });

  it("[UNIT] recognises definitive broker refusals as safe to resubmit", () => {
    for (const numericCode of [10014, 10016, 10018, 10019]) {
      const verdict = interpretTradeResponse({ numericCode });
      expect(verdict.outcome).toBe("rejected");
      expect(verdict.safeToResubmit).toBe(true);
    }
  });

  it("[INVARIANT] an absent or unmapped code is unknown and never resubmitted blindly", () => {
    for (const res of [null, undefined, {}, { numericCode: null }, { numericCode: 99999 }, { numericCode: 10004 }]) {
      const verdict = interpretTradeResponse(res);
      expect(verdict.outcome).toBe("unknown");
      expect(verdict.safeToResubmit).toBe(false);
    }
  });

  it("[UNIT] carries broker identifiers through for reconciliation", () => {
    const verdict = interpretTradeResponse({
      numericCode: 10009,
      stringCode: "TRADE_RETCODE_DONE",
      message: "Request completed",
      orderId: "556677",
      positionId: "998877",
    });
    expect(verdict.orderId).toBe("556677");
    expect(verdict.positionId).toBe("998877");
    expect(verdict.stringCode).toBe("TRADE_RETCODE_DONE");
  });
});
