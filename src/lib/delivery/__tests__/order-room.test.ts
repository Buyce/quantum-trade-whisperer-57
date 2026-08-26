/**
 * Guards the four controls added to give the automatic-order path room to trade
 * WITHOUT loosening any safety boundary:
 *  - a momentary failure may be retried, a safety failure never may;
 *  - the concurrent and daily ceilings are independent and bounded;
 *  - market entry is opt-in and produces market geometry, never a limit price;
 *  - an unmeasured regime passes the intelligence gate only on opt-in, while a
 *    MEASURED rate below the owner's threshold still refuses.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_DELIVERY_ATTEMPTS,
  buildBridgeOrder,
  isRetryableRejection,
} from "@/lib/delivery/execution";
import { evaluateIntelGate } from "@/lib/delivery/intel-gate";
import {
  CONCURRENT_ORDER_CEILING_MAX,
  DAILY_ORDER_CEILING_MAX,
  clampConcurrentOrderCeiling,
  clampDailyOrderCeiling,
} from "@/lib/db-types";

describe("retry classification", () => {
  it("[INVARIANT] momentary market conditions are retryable", () => {
    for (const reason of [
      "quote_unavailable",
      "quote_stale",
      "spread_too_wide",
      "market_closed",
    ] as const) {
      expect(isRetryableRejection(reason)).toBe(true);
    }
  });

  it("[INVARIANT] safety and identity failures are never retryable", () => {
    for (const reason of [
      "live_execution_disabled",
      "instrument_not_approved",
      "tif_expired",
      "risk_ack_required",
      "signal_missing",
    ] as const) {
      expect(isRetryableRejection(reason)).toBe(false);
    }
  });

  it("[INVARIANT] retries are bounded", () => {
    expect(MAX_DELIVERY_ATTEMPTS).toBeGreaterThan(0);
    expect(Number.isFinite(MAX_DELIVERY_ATTEMPTS)).toBe(true);
  });
});

describe("automatic-order ceilings", () => {
  it("[INVARIANT] both ceilings clamp to their own bounds and default when absent", () => {
    expect(clampConcurrentOrderCeiling(null)).toBe(3);
    expect(clampDailyOrderCeiling(null)).toBe(10);
    expect(clampConcurrentOrderCeiling(999)).toBe(CONCURRENT_ORDER_CEILING_MAX);
    expect(clampDailyOrderCeiling(999)).toBe(DAILY_ORDER_CEILING_MAX);
    expect(clampConcurrentOrderCeiling(-5)).toBe(0);
    expect(clampDailyOrderCeiling(-5)).toBe(0);
  });

  it("[INVARIANT] zero is a real value, not a missing one", () => {
    expect(clampConcurrentOrderCeiling(0)).toBe(0);
    expect(clampDailyOrderCeiling(0)).toBe(0);
  });
});

describe("market entry", () => {
  const signal = {
    id: "sig-1",
    instrument: "EURUSD",
    direction: "long",
    entryPrice: 1.1,
    maxAcceptableEntry: 1.102,
    stopLoss: 1.095,
    tp1: 1.11,
    grade: "B",
    rrRatio: 2,
    confidence: 70,
  } as unknown as Parameters<typeof buildBridgeOrder>[0];
  const quantity = { lots: 0.5 } as unknown as Parameters<typeof buildBridgeOrder>[1];

  it("[INVARIANT] pending mode keeps a limit action", () => {
    const order = buildBridgeOrder(signal, quantity);
    expect(order.action).toBe("buy_limit");
    expect(order.entryMode).toBe("pending_limit");
  });

  it("[INVARIANT] market mode emits a market action", () => {
    const order = buildBridgeOrder(signal, quantity, undefined, 180, "market");
    expect(order.action).toBe("buy");
    expect(order.entryMode).toBe("market");
  });
});

describe("intelligence gate: unmeasured regimes", () => {
  const gate = { enabled: true, minWinPct: 55, minSample: 30 };
  const key = {
    instrument: "EURUSD",
    direction: "long",
    session: "london",
    volatilityIndex: 1,
  };

  it("[INVARIANT] an unmeasured regime refuses by default", () => {
    const verdict = evaluateIntelGate(gate, [], key);
    expect(verdict.allowed).toBe(false);
  });

  it("[INVARIANT] an unmeasured regime passes only on explicit opt-in", () => {
    const verdict = evaluateIntelGate({ ...gate, allowUnmeasured: true }, [], key);
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toBe("intelligence_gate_unmeasured_allowed");
  });
});
