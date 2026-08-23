/**
 * Stage-3 direct execution safety tests.
 *
 * These lock the financial invariants: unknown broker state never authorises an
 * order, geometry is never corrected, margin is never estimated locally, and an
 * ambiguous broker verdict never collapses into "rejected".
 */
import { describe, expect, it } from "vitest";

import {
  actionTypeFor,
  buildDirectOrder,
  deliveryStateForVerdict,
  directExecutionAllowed,
  DirectOrderError,
  marginAcceptable,
  modeIsAutomatic,
  orderExpiry,
  type DirectGateInput,
  type DirectOrderPlan,
} from "../direct";
import { ORDER_TIF_MINUTES } from "@/lib/db-types";
import { isPTradesClientId } from "@/lib/metaapi/client-id";
import { interpretTradeResponse } from "@/lib/metaapi/trade-result";

const gate = (over: Partial<DirectGateInput> = {}): DirectGateInput => ({
  mode: "demo_auto",
  brokerAccountType: "demo",
  tradeAllowed: true,
  investorMode: false,
  ready: true,
  intentConflict: false,
  globalDemoAuto: true,
  globalLiveAuto: false,
  ...over,
});

const plan: DirectOrderPlan = {
  signalId: "3f4a1c9e-2b6d-4f7a-9c11-8d5e6f7a8b9c",
  direction: "long",
  entryPrice: 1.085,
  stopLoss: 1.08,
  tp1: 1.095,
  grade: "A",
  detectedAt: "2026-08-24T09:00:00.000Z",
};

const quantity = {
  lots: 0.25,
  sizingModel: 1 as const,
  specSource: "static_v1" as const,
  specAsOf: null,
};

describe("direct execution gating", () => {
  it("only demo_auto and live_auto submit automatically", () => {
    expect(modeIsAutomatic("observe")).toBe(false);
    expect(modeIsAutomatic("live_confirm")).toBe(false);
    expect(modeIsAutomatic("demo_auto")).toBe(true);
    expect(modeIsAutomatic("live_auto")).toBe(true);
  });

  it("allows a fully proven demo account", () => {
    expect(directExecutionAllowed(gate()).ok).toBe(true);
  });

  it("refuses when the global demo gate is off", () => {
    expect(directExecutionAllowed(gate({ globalDemoAuto: false })).ok).toBe(false);
  });

  it("refuses an unknown broker account type", () => {
    expect(directExecutionAllowed(gate({ brokerAccountType: "unknown" })).ok).toBe(false);
  });

  it("refuses a real account in demo_auto", () => {
    expect(directExecutionAllowed(gate({ brokerAccountType: "real" })).ok).toBe(false);
  });

  it("refuses live_auto unless the account is broker-confirmed real AND gated on", () => {
    expect(
      directExecutionAllowed(gate({ mode: "live_auto", brokerAccountType: "demo" })).ok,
    ).toBe(false);
    expect(
      directExecutionAllowed(
        gate({ mode: "live_auto", brokerAccountType: "real", globalLiveAuto: false }),
      ).ok,
    ).toBe(false);
    expect(
      directExecutionAllowed(
        gate({ mode: "live_auto", brokerAccountType: "real", globalLiveAuto: true }),
      ).ok,
    ).toBe(true);
  });

  it("refuses investor-only and non-tradable connections", () => {
    expect(directExecutionAllowed(gate({ investorMode: true })).ok).toBe(false);
    expect(directExecutionAllowed(gate({ tradeAllowed: null })).ok).toBe(false);
  });

  it("refuses an account that is not broker-confirmed or is conflicted", () => {
    expect(directExecutionAllowed(gate({ ready: false })).ok).toBe(false);
    expect(directExecutionAllowed(gate({ intentConflict: true })).ok).toBe(false);
  });
});

describe("server-side order construction", () => {
  it("builds a protected pending limit order with our own clientId", () => {
    const order = buildDirectOrder(plan, {
      brokerSymbol: "EURUSD.r",
      magic: 140714,
      quantity,
      deliveryId: 4821,
    });
    expect(order.actionType).toBe("ORDER_TYPE_BUY_LIMIT");
    expect(order.symbol).toBe("EURUSD.r");
    expect(order.volume).toBe(0.25);
    expect(order.stopLoss).toBe(plan.stopLoss);
    expect(order.takeProfit).toBe(plan.tp1);
    expect(isPTradesClientId(order.clientId)).toBe(true);
    expect(order.clientId).toContain("4821");
  });

  it("expires at the plan's time-in-force measured from detection", () => {
    expect(orderExpiry(plan.detectedAt)).toBe(
      new Date(Date.parse(plan.detectedAt) + ORDER_TIF_MINUTES * 60_000).toISOString(),
    );
  });

  it("maps direction to a limit action and refuses anything else", () => {
    expect(actionTypeFor("short")).toBe("ORDER_TYPE_SELL_LIMIT");
    expect(() => actionTypeFor("sideways")).toThrow(DirectOrderError);
  });

  it("refuses contradictory geometry instead of correcting it", () => {
    expect(() =>
      buildDirectOrder(
        { ...plan, stopLoss: 1.09 },
        { brokerSymbol: "EURUSD", magic: 1, quantity, deliveryId: 1 },
      ),
    ).toThrow(DirectOrderError);
  });

  it("refuses when there is no quantity, symbol or magic", () => {
    const ctx = { brokerSymbol: "EURUSD", magic: 1, quantity, deliveryId: 1 };
    expect(() =>
      buildDirectOrder(plan, { ...ctx, quantity: { ...quantity, lots: 0 } }),
    ).toThrow(DirectOrderError);
    expect(() => buildDirectOrder(plan, { ...ctx, brokerSymbol: "  " })).toThrow(DirectOrderError);
    expect(() => buildDirectOrder(plan, { ...ctx, magic: 0 })).toThrow(DirectOrderError);
  });
});

describe("broker-authoritative margin gate", () => {
  it("refuses when the broker gave no margin answer", () => {
    expect(marginAcceptable(null, 10_000).ok).toBe(false);
  });

  it("refuses when free margin is unknown", () => {
    expect(marginAcceptable(100, null).ok).toBe(false);
  });

  it("refuses when the broker margin is too large a share of free margin", () => {
    expect(marginAcceptable(6_000, 10_000).ok).toBe(false);
    expect(marginAcceptable(1_000, 10_000).ok).toBe(true);
  });
});

describe("broker verdict → delivery state", () => {
  it("accepts only documented success codes", () => {
    expect(deliveryStateForVerdict(interpretTradeResponse({ numericCode: 10009 }))).toBe(
      "acknowledged",
    );
  });

  it("keeps an unmapped or absent code as unknown, never rejected", () => {
    expect(deliveryStateForVerdict(interpretTradeResponse({ numericCode: 99999 }))).toBe("unknown");
    expect(deliveryStateForVerdict(interpretTradeResponse(null))).toBe("unknown");
  });

  it("rejects only definitive broker refusals", () => {
    expect(deliveryStateForVerdict(interpretTradeResponse({ numericCode: 10019 }))).toBe(
      "rejected",
    );
  });
});
