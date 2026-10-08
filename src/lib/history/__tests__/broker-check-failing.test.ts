import { describe, expect, it } from "vitest";

import { brokerCheckFailing, brokerOrderStatus } from "../broker-orders";

const NOW = Date.parse("2026-10-08T11:00:00.000Z");
const accepted = {
  state: "acknowledged",
  reason: null,
  broker_retcode_string: "TRADE_RETCODE_DONE",
  submitted_at: "2026-09-30T15:32:12.000Z",
  broker_order_state: null,
};

describe("broker check failing label", () => {
  it("[UNIT] an accepted order the check has not read since submission says the check is failing", () => {
    const status = brokerCheckFailing(
      accepted.submitted_at,
      {
        lastSuccessAt: "2026-09-25T06:00:02.000Z",
        lastErrorAt: "2026-10-08T09:41:00.000Z",
        lastError: "broker history unavailable — MetaApi 504",
      },
      NOW,
    );
    expect(status?.label).toBe("Accepted by broker — broker check failing");
    expect(status?.detail).toContain("2026-09-25 06:00 UTC");
    expect(status?.detail).toContain("MetaApi 504");
  });

  it("[UNIT] a check that succeeded after submission keeps the neutral awaiting-evidence label", () => {
    expect(
      brokerCheckFailing(
        accepted.submitted_at,
        { lastSuccessAt: "2026-10-01T00:00:00.000Z", lastErrorAt: null, lastError: null },
        NOW,
      ),
    ).toBeNull();
  });

  it("[UNIT] a freshly submitted order is not blamed on the check", () => {
    expect(
      brokerCheckFailing(
        "2026-10-08T09:00:00.000Z",
        { lastSuccessAt: "2026-09-25T06:00:02.000Z", lastErrorAt: null, lastError: null },
        NOW,
      ),
    ).toBeNull();
  });

  it("[UNIT] without account health the order still reads awaiting evidence", () => {
    expect(brokerOrderStatus(accepted, null).label).toBe("Accepted by broker — awaiting evidence");
  });
});
