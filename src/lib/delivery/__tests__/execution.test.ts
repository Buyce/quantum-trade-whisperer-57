import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXECUTION_POLICY,
  buildBridgeOrder,
  isClaimable,
  isTerminal,
  spreadAcceptable,
  withinMaxAcceptableEntry,
  type BridgeSignal,
} from "../execution";
import { evaluateExposure } from "../exposure";
import { ORDER_TIF_MINUTES } from "@/lib/db-types";

const long: BridgeSignal = {
  id: "s1",
  instrument: "EURUSD",
  grade: "A",
  direction: "long",
  entryPrice: 1.156,
  maxAcceptableEntry: 1.15615,
  stopLoss: 1.155,
  tp1: 1.157,
  tp2: 1.158,
  tp3: 1.159,
  rrRatio: 3,
  confidence: 82,
};

describe("bridge order", () => {
  it("is always a limit order carrying the single first-target exit", () => {
    const order = buildBridgeOrder(long);
    expect(order.action).toBe("buy_limit");
    expect(order.takeProfit).toBe(long.tp1);
    expect(order.policy).toBe(DEFAULT_EXECUTION_POLICY);
    expect(order.expiresInMinutes).toBe(ORDER_TIF_MINUTES);
  });

  it("mirrors direction for shorts", () => {
    expect(buildBridgeOrder({ ...long, direction: "short" }).action).toBe("sell_limit");
  });

  it("refuses an unsupported policy rather than inventing behaviour", () => {
    expect(() =>
      buildBridgeOrder(long, "multi_exit" as unknown as typeof DEFAULT_EXECUTION_POLICY),
    ).toThrow();
  });
});

describe("state machine", () => {
  it("only claims pending, and never re-claims an unacknowledged send", () => {
    expect(isClaimable("pending")).toBe(true);
    for (const s of ["claimed", "sent", "unknown", "acknowledged", "rejected", "failed"] as const) {
      expect(isClaimable(s), s).toBe(false);
    }
    expect(isTerminal("sent")).toBe(true);
    expect(isTerminal("claimed")).toBe(false);
  });
});

describe("price gates", () => {
  it("rejects a long once price is beyond the slippage ceiling", () => {
    const order = buildBridgeOrder(long);
    expect(withinMaxAcceptableEntry(order, 1.1561)).toBe(true);
    expect(withinMaxAcceptableEntry(order, 1.15625)).toBe(false);
  });

  it("mirrors the ceiling for shorts", () => {
    const order = buildBridgeOrder({
      ...long,
      direction: "short",
      entryPrice: 1.156,
      stopLoss: 1.157,
      maxAcceptableEntry: 1.15585,
    });
    expect(withinMaxAcceptableEntry(order, 1.1559)).toBe(true);
    expect(withinMaxAcceptableEntry(order, 1.1558)).toBe(false);
  });

  it("rejects a spread larger than 15% of planned risk", () => {
    const order = buildBridgeOrder(long); // risk = 0.001
    expect(spreadAcceptable(order, 1.156, 1.15612)).toBe(true);
    expect(spreadAcceptable(order, 1.156, 1.1562)).toBe(false);
  });

  it("treats a zero-risk setup as unacceptable rather than dividing by zero", () => {
    expect(spreadAcceptable({ entry: 1.156, stopLoss: 1.156 }, 1.156, 1.156)).toBe(false);
  });
});

describe("execution exposure limits", () => {
  it("blocks when combined risk would exceed the ceiling", () => {
    expect(
      evaluateExposure({ openRiskR: 2, pendingRiskR: 1, realizedLossTodayR: 0 }).allowed,
    ).toBe(false);
    expect(
      evaluateExposure({ openRiskR: 1, pendingRiskR: 0, realizedLossTodayR: 0 }).allowed,
    ).toBe(true);
  });

  it("blocks after the daily logged loss limit", () => {
    const verdict = evaluateExposure({ openRiskR: 0, pendingRiskR: 0, realizedLossTodayR: 2 });
    expect(verdict.allowed).toBe(false);
    expect(verdict.detail).toContain("logged");
  });
});
