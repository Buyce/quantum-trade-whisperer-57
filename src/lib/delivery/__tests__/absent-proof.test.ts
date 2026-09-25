import { describe, expect, it } from "vitest";

import { brokerProvedAbsent } from "../expire-unfilled.server";

const base = {
  sent_at: "2026-09-03T18:00:00Z",
  submitted_at: null,
  client_id: "PT_x",
  broker_order_state: "absent",
  broker_state_at: "2026-09-10T18:00:00Z",
};

describe("brokerProvedAbsent", () => {
  it("[UNIT] settles only a broker-confirmed absence a day after submission", () => {
    expect(brokerProvedAbsent(base)).toBe(true);
  });
  it("[UNIT] refuses an early reading", () => {
    expect(brokerProvedAbsent({ ...base, broker_state_at: "2026-09-03T20:00:00Z" })).toBe(false);
  });
  it("[UNIT] refuses without a client id or with a non-absent state", () => {
    expect(brokerProvedAbsent({ ...base, client_id: null })).toBe(false);
    expect(brokerProvedAbsent({ ...base, broker_order_state: "closed" })).toBe(false);
    expect(brokerProvedAbsent({ ...base, broker_order_state: null })).toBe(false);
  });
});
