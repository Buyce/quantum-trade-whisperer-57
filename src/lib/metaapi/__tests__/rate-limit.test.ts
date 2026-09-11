import { describe, expect, it } from "vitest";
import {
  RATE_LIMIT_BASE_DELAY_MS,
  RATE_LIMIT_MAX_DELAY_MS,
  rateLimitDelayMs,
} from "@/lib/metaapi/request.server";
import {
  MARKET_DATA_MAX_CONCURRENCY,
  MARKET_DATA_WAIT_TIMEOUT_MS,
  marketDataInFlight,
  withMarketDataSlot,
} from "@/lib/metaapi/market-gate.server";


describe("rateLimitDelayMs", () => {
  it("[UNIT] honours the provider retry-after when it is longer than our backoff", () => {
    expect(rateLimitDelayMs(2, 0)).toBe(2_000);
  });

  it("[UNIT] falls back to exponential backoff without a header", () => {
    expect(rateLimitDelayMs(null, 0)).toBe(RATE_LIMIT_BASE_DELAY_MS);
    expect(rateLimitDelayMs(null, 1)).toBe(RATE_LIMIT_BASE_DELAY_MS * 2);
  });

  it("[UNIT] never waits longer than the cap, so a cycle cannot overrun", () => {
    expect(rateLimitDelayMs(600, 0)).toBe(RATE_LIMIT_MAX_DELAY_MS);
    expect(rateLimitDelayMs(null, 9)).toBe(RATE_LIMIT_MAX_DELAY_MS);
  });
});

describe("market-data concurrency gate", () => {
  it("[UNIT] never runs more reads at once than the provider allows", async () => {
    let peak = 0;
    const task = async () => {
      peak = Math.max(peak, marketDataInFlight());
      await new Promise((r) => setTimeout(r, 5));
    };
    await Promise.all(Array.from({ length: 12 }, () => withMarketDataSlot(task)));
    expect(peak).toBeLessThanOrEqual(MARKET_DATA_MAX_CONCURRENCY);
    expect(marketDataInFlight()).toBe(0);
  });

  it("[UNIT] releases the slot when the read throws", async () => {
    await expect(
      withMarketDataSlot(async () => {
        throw new Error("provider refused");
      }),
    ).rejects.toThrow("provider refused");
    expect(marketDataInFlight()).toBe(0);
  });

  it("[UNIT] never waits for a slot without a deadline", async () => {
    // A cancelled pass leaves its cleanup unrun; an unbounded waiter then hangs
    // the whole invocation and the platform cancels it as never responding.
    expect(MARKET_DATA_WAIT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(MARKET_DATA_WAIT_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
  });

  it("[UNIT] gives the slot back to a waiter as soon as a holder finishes", async () => {
    const order: string[] = [];
    const hold = (name: string, ms: number) =>
      withMarketDataSlot(async () => {
        await new Promise((r) => setTimeout(r, ms));
        order.push(name);
      });
    await Promise.all([
      hold("a", 5),
      hold("b", 5),
      hold("c", 5),
      hold("d", 5),
      hold("e", 1),
    ]);
    expect(order).toHaveLength(5);
    expect(order[4]).toBe("e");
    expect(marketDataInFlight()).toBe(0);
  });
});

