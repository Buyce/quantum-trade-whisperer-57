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

const qty = {
  lots: 0.25,
  sizingModel: 1 as const,
  specSource: "static_v1" as const,
  specAsOf: null,
};

describe("bridge order", () => {
  it("[UNIT] is always a limit order carrying the single first-target exit", () => {
    const order = buildBridgeOrder(long, qty);
    expect(order.action).toBe("buy_limit");
    expect(order.takeProfit).toBe(long.tp1);
    expect(order.policy).toBe(DEFAULT_EXECUTION_POLICY);
    expect(order.expiresInMinutes).toBe(ORDER_TIF_MINUTES);
  });

  it("[UNIT] mirrors direction for shorts", () => {
    expect(buildBridgeOrder({ ...long, direction: "short" }, qty).action).toBe("sell_limit");
  });

  it("[UNIT] refuses an unsupported policy rather than inventing behaviour", () => {
    expect(() =>
      buildBridgeOrder(long, qty, "multi_exit" as unknown as typeof DEFAULT_EXECUTION_POLICY),
    ).toThrow();
  });
});

describe("state machine", () => {
  it("[UNIT] only claims pending, and never re-claims an unacknowledged send", () => {
    expect(isClaimable("pending")).toBe(true);
    for (const s of ["claimed", "sent", "unknown", "acknowledged", "rejected", "failed"] as const) {
      expect(isClaimable(s), s).toBe(false);
    }
    expect(isTerminal("sent")).toBe(true);
    expect(isTerminal("claimed")).toBe(false);
  });
});

describe("price gates", () => {
  it("[UNIT] rejects a long once price is beyond the slippage ceiling", () => {
    const order = buildBridgeOrder(long, qty);
    expect(withinMaxAcceptableEntry(order, 1.1561)).toBe(true);
    expect(withinMaxAcceptableEntry(order, 1.15625)).toBe(false);
  });

  it("[UNIT] mirrors the ceiling for shorts", () => {
    const order = buildBridgeOrder(
      {
        ...long,
        direction: "short",
        entryPrice: 1.156,
        stopLoss: 1.157,
        maxAcceptableEntry: 1.15585,
      },
      qty,
    );
    expect(withinMaxAcceptableEntry(order, 1.1559)).toBe(true);
    expect(withinMaxAcceptableEntry(order, 1.1558)).toBe(false);
  });

  it("[INVARIANT] lets a pending buy limit rest below a market that has run up", () => {
    const order = buildBridgeOrder(long, qty); // entry 1.156
    // The market running away ABOVE a buy limit cannot slip the fill: the order
    // waits. This is exactly the case the market-entry ceiling used to refuse.
    expect(pendingLimitSideValid(order, 1.16)).toBe(true);
    expect(withinMaxAcceptableEntry(order, 1.16)).toBe(false);
  });

  it("[INVARIANT] refuses a pending limit the market has already reached", () => {
    const order = buildBridgeOrder(long, qty);
    expect(pendingLimitSideValid(order, 1.156)).toBe(false);
    expect(pendingLimitSideValid(order, 1.1555)).toBe(false);
  });

  it("[UNIT] mirrors pending-side validity for a sell limit", () => {
    const short = buildBridgeOrder(
      { ...long, direction: "short", entryPrice: 1.156, stopLoss: 1.157 },
      qty,
    );
    expect(pendingLimitSideValid(short, 1.1555)).toBe(true);
    expect(pendingLimitSideValid(short, 1.1565)).toBe(false);
  });

  it("[INVARIANT] enforces the broker minimum distance and never assumes one", () => {
    const order = buildBridgeOrder(long, qty);
    expect(pendingLimitSideValid(order, 1.1562, 0.0005)).toBe(false);
    expect(pendingLimitSideValid(order, 1.1566, 0.0005)).toBe(true);
    expect(pendingLimitSideValid(order, 1.16, Number.NaN)).toBe(false);
  });

  it("[UNIT] rejects a spread larger than 15% of planned risk", () => {
    const order = buildBridgeOrder(long, qty); // risk = 0.001
    expect(spreadAcceptable(order, 1.156, 1.15612)).toBe(true);
    expect(spreadAcceptable(order, 1.156, 1.1562)).toBe(false);
    expect(spreadAcceptable(order, 1.1562, 1.156)).toBe(false);
  });

  it("[UNIT] treats a zero-risk setup as unacceptable rather than dividing by zero", () => {
    expect(spreadAcceptable({ entry: 1.156, stopLoss: 1.156 }, 1.156, 1.156)).toBe(false);
  });
});

describe("execution exposure limits", () => {
  const over = { openRiskR: 2, pendingRiskR: 1, realizedLossTodayR: 0 };

  it("[UNIT] is advisory by default: an exceeded limit does not block", () => {
    const verdict = evaluateExposure(over);
    expect(verdict.exceeded).toBe(true);
    expect(verdict.allowed).toBe(true);
    expect(verdict.enforced).toBe(false);
  });

  it("[UNIT] blocks only after the user opts in", () => {
    const verdict = evaluateExposure(over, 1, { enforce: true });
    expect(verdict.exceeded).toBe(true);
    expect(verdict.allowed).toBe(false);
  });

  it("[UNIT] leaves a within-limit snapshot untouched", () => {
    const verdict = evaluateExposure({ openRiskR: 1, pendingRiskR: 0, realizedLossTodayR: 0 }, 1, {
      enforce: true,
    });
    expect(verdict.exceeded).toBe(false);
    expect(verdict.allowed).toBe(true);
  });

  it("[UNIT] attributes the daily loss limit to trades the user logged, not the broker", () => {
    const verdict = evaluateExposure({ openRiskR: 0, pendingRiskR: 0, realizedLossTodayR: 2 }, 1, {
      enforce: true,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.detail).toContain("trades you logged");
    expect(verdict.detail).toContain("not broker-account exposure");
  });
});
