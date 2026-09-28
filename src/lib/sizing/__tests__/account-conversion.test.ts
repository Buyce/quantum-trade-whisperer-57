import { describe, expect, it, vi } from "vitest";
import { resolveAccountConversion } from "../account-conversion.server";

const NOW = Date.parse("2026-09-28T11:47:37.000Z");

function accountDb() {
  const calls: string[] = [];
  const db = {
    from(table: string) {
      calls.push(table);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: async () => ({
                  data: { metaapi_account_id: "concept-id", region: "london" },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      };
    },
  };
  return { db: db as never, calls };
}

describe("destination-account FX conversion", () => {
  it("[INVARIANT] resolves USD to AUD from the Concept account's confirmed AUDUSD.c quote", async () => {
    const { db, calls } = accountDb();
    const symbols = vi.fn(async () => ["EURUSD.c", "AUDUSD.c"]);
    const quote = vi.fn(async () => ({
      bid: 0.68,
      ask: 0.6802,
      sourceTime: new Date(NOW - 1000).toISOString(),
      receivedAt: new Date(NOW).toISOString(),
    }));
    const result = await resolveAccountConversion(db, "user-1", "account-1", "USD", "AUD", NOW, {
      symbols,
      quote,
    });
    expect(calls).toEqual(["connected_trading_accounts"]);
    expect(symbols).toHaveBeenCalledWith("concept-id", "london");
    expect(quote).toHaveBeenCalledWith("concept-id", "london", "AUDUSD.c");
    expect(result.rates["AUDUSD"]).toBeCloseTo(0.6801);
    expect(result.stale).toBe(false);
  });

  it("[UNIT] makes no broker requests when quote and account currencies match", async () => {
    const { db, calls } = accountDb();
    const symbols = vi.fn();
    const quote = vi.fn();
    const result = await resolveAccountConversion(db, "user-1", "account-1", "AUD", "AUD", NOW, {
      symbols,
      quote,
    });
    expect(result.route).toBe("parity");
    expect(calls).toEqual([]);
    expect(symbols).not.toHaveBeenCalled();
    expect(quote).not.toHaveBeenCalled();
  });

  it("[INVARIANT] refuses an ambiguous symbol instead of choosing a suffix", async () => {
    const { db } = accountDb();
    const quote = vi.fn();
    const result = await resolveAccountConversion(db, "user-1", "account-1", "USD", "AUD", NOW, {
      symbols: async () => ["AUDUSD.c", "AUDUSD.raw"],
      quote,
    });
    expect(result.rates).toEqual({});
    expect(quote).not.toHaveBeenCalled();
  });

  it("[INVARIANT] rejects a stale conversion quote", async () => {
    const { db } = accountDb();
    const result = await resolveAccountConversion(db, "user-1", "account-1", "USD", "AUD", NOW, {
      symbols: async () => ["AUDUSD.c"],
      quote: async () => ({
        bid: 0.68,
        ask: 0.6802,
        sourceTime: new Date(NOW - 120_000).toISOString(),
        receivedAt: new Date(NOW).toISOString(),
      }),
    });
    expect(result.stale).toBe(true);
  });
});
