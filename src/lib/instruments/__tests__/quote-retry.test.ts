import { describe, expect, it } from "vitest";

import { fetchUsableQuote } from "../quote-retry";

const noSleep = async () => {};

describe("bounded re-quote for readiness", () => {
  it("[UNIT] a single malformed tick is retried and the next good tick is accepted", async () => {
    let call = 0;
    const outcome = await fetchUsableQuote(
      "GBPUSD",
      async () => {
        call += 1;
        return call === 1 ? { bid: 1.3639, ask: 1.3639 } : { bid: 1.3639, ask: 1.36392 };
      },
      { sleep: noSleep },
    );

    expect(outcome.quote).not.toBeNull();
    expect(outcome.attempts).toBe(2);
    expect(outcome.failure).toBeNull();
    expect(outcome.detail).toContain("attempt 2");
  });

  it("[INVARIANT] a persistently zero spread still fails, and says how hard we tried", async () => {
    const outcome = await fetchUsableQuote("GBPUSD", async () => ({ bid: 1.3639, ask: 1.3639 }), {
      sleep: noSleep,
    });

    expect(outcome.quote).toBeNull();
    expect(outcome.failure).toBe("zero_or_inverted_spread");
    expect(outcome.attempts).toBe(3);
    expect(outcome.detail).toContain("all 3 attempts");
  });

  it("[INVARIANT] no quote at all is reported differently from a malformed tick", async () => {
    const none = await fetchUsableQuote("USDCHF", async () => null, { sleep: noSleep });
    expect(none.failure).toBe("no_quote");

    const crossed = await fetchUsableQuote("USDCHF", async () => ({ bid: 1.1, ask: 0.9 }), {
      sleep: noSleep,
    });
    expect(crossed.failure).toBe("malformed_tick");
  });

  it("[INVARIANT] a thrown fetch is retried but never becomes a usable quote", async () => {
    let calls = 0;
    const outcome = await fetchUsableQuote(
      "USDCHF",
      async () => {
        calls += 1;
        throw new Error("timeout after 8000ms");
      },
      { sleep: noSleep },
    );

    expect(calls).toBe(3);
    expect(outcome.quote).toBeNull();
    expect(outcome.failure).toBe("fetch_failed");
    expect(outcome.detail).toContain("timeout after 8000ms");
  });

  it("[INVARIANT] freshness is enforced when required and ignored when not", async () => {
    const now = Date.parse("2026-08-26T03:10:00Z");
    const stale = { bid: 1.1, ask: 1.1002, sourceTime: "2026-08-26T02:00:00Z" };

    const enforced = await fetchUsableQuote("EURUSD", async () => stale, {
      requireFreshness: true,
      maxAgeMs: 90_000,
      now: () => now,
      sleep: noSleep,
    });
    expect(enforced.failure).toBe("stale_source_time");

    const relaxed = await fetchUsableQuote("EURUSD", async () => stale, {
      now: () => now,
      sleep: noSleep,
    });
    expect(relaxed.quote).not.toBeNull();
  });
});
