/**
 * Prompt 12 closure — defect A: quote-source timestamps fail closed.
 *
 * A broker price may only back a real position size when the BROKER supplied a
 * parseable timestamp inside the freshness window. Receipt time is never a
 * substitute, so missing and malformed timestamps are as unusable as old ones.
 */
import { describe, expect, it, vi } from "vitest";
import { QUOTE_MAX_AGE_MS, resolveConversion } from "../conversion.server";

const NOW = Date.parse("2026-08-23T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function fetcher(quote: unknown) {
  return vi.fn(async () => quote as never);
}

describe("conversion quote freshness", () => {
  it("[UNIT] a fresh broker timestamp is usable and reported", async () => {
    const r = await resolveConversion("AUD", "USD", fetcher({ bid: 0.66, ask: 0.661, sourceTime: iso(NOW - 5_000) }), NOW);
    expect(r.stale).toBe(false);
    expect(r.timestampMissing).toBe(false);
    expect(r.quoteAsOf).toBe(iso(NOW - 5_000));
  });

  it("[INVARIANT] a stale broker timestamp is stale", async () => {
    const r = await resolveConversion(
      "AUD",
      "USD",
      fetcher({ bid: 0.66, ask: 0.661, sourceTime: iso(NOW - QUOTE_MAX_AGE_MS - 1_000) }),
      NOW,
    );
    expect(r.stale).toBe(true);
  });

  it("[INVARIANT] a missing broker timestamp is never treated as fresh", async () => {
    const r = await resolveConversion("AUD", "USD", fetcher({ bid: 0.66, ask: 0.661 }), NOW);
    expect(r.timestampMissing).toBe(true);
    expect(r.stale).toBe(true);
    expect(r.quoteAsOf).toBeNull();
  });

  it("[INVARIANT] a malformed broker timestamp is never treated as fresh", async () => {
    const r = await resolveConversion(
      "AUD",
      "USD",
      fetcher({ bid: 0.66, ask: 0.661, sourceTime: "not-a-date" }),
      NOW,
    );
    expect(r.timestampMissing).toBe(true);
    expect(r.stale).toBe(true);
  });

  it("[UNIT] parity needs no leg, so nothing can be stale", async () => {
    const fetch = fetcher(null);
    const r = await resolveConversion("USD", "USD", fetch, NOW);
    expect(fetch).not.toHaveBeenCalled();
    expect(r.stale).toBe(false);
    expect(r.timestampMissing).toBe(false);
  });
});
