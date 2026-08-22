/**
 * Prompt 11 — MCP position sizing must not spend broker requests it does not
 * need, and must never substitute a guessed rate for a missing one.
 */
import { describe, expect, it, vi } from "vitest";
import { buildRates, fetchMids, planConversion, resolveConversionRates } from "../fx";
import { CONTRACT_SPECS, calculateRisk, type RiskProfile } from "@/lib/risk";

describe("planConversion", () => {
  it("[UNIT] needs zero quotes when the quote currency is the account currency", () => {
    expect(planConversion("USD", "USD")).toEqual({ kind: "parity", symbols: [] });
    // XAUUSD and EURUSD are USD-quoted: a USD account needs no FX at all.
    expect(planConversion(CONTRACT_SPECS["XAUUSD"]!.quote, "USD").symbols).toEqual([]);
    expect(planConversion(CONTRACT_SPECS["EURUSD"]!.quote, "USD").symbols).toEqual([]);
  });

  it("[UNIT] uses one direct or inverse quote when a USD leg exists", () => {
    // GBPAUD is AUD-quoted; a USD account converts through AUDUSD only.
    expect(planConversion(CONTRACT_SPECS["GBPAUD"]!.quote, "USD")).toEqual({
      kind: "direct",
      symbols: ["AUDUSD"],
    });
    expect(planConversion("USD", "AUD")).toEqual({ kind: "inverse", symbols: ["AUDUSD"] });
  });

  it("[UNIT] crosses through USD with exactly two quotes when neither leg is USD", () => {
    expect(planConversion("AUD", "EUR")).toEqual({
      kind: "cross",
      symbols: ["AUDUSD", "EURUSD"],
      via: "USD",
    });
  });

  it("[INVARIANT] reports unsupported instead of inventing a route", () => {
    expect(planConversion("XAU", "ZWL")).toEqual({ kind: "unsupported", symbols: [] });
    expect(buildRates("XAU", "ZWL", planConversion("XAU", "ZWL"), {})).toEqual({});
  });
});

describe("fetchMids", () => {
  it("[INVARIANT] issues one request per distinct symbol and none for an empty plan", async () => {
    const fetchQuote = vi.fn(async () => ({ bid: 0.66, ask: 0.6602 }));
    await fetchMids([], fetchQuote);
    expect(fetchQuote).toHaveBeenCalledTimes(0);
    await fetchMids(["AUDUSD", "AUDUSD", "EURUSD"], fetchQuote);
    expect(fetchQuote).toHaveBeenCalledTimes(2);
  });

  it("[INVARIANT] omits a failed leg rather than assuming parity", async () => {
    const fetchQuote = vi.fn(async () => {
      throw new Error("timeout");
    });
    expect(await fetchMids(["AUDUSD"], fetchQuote)).toEqual({});
  });
});

const profile = (accountCurrency: string): RiskProfile => ({
  accountEquity: 10_000,
  accountCurrency,
  riskPerTradePercent: 1,
  maxPositionSize: 0,
  leverage: 100,
  maxStopLossPercent: 0,
});

describe("resolveConversionRates + calculateRisk", () => {
  it("[INVARIANT] a matching-currency sizing call makes zero broker requests", async () => {
    const fetchQuote = vi.fn(async () => ({ bid: 1, ask: 1 }));
    const { plan, rates, requests } = await resolveConversionRates("USD", "USD", fetchQuote);
    expect(plan.kind).toBe("parity");
    expect(requests).toBe(0);
    expect(fetchQuote).toHaveBeenCalledTimes(0);
    const result = calculateRisk(
      { instrument: "XAUUSD", entryPrice: 2400, stopLoss: 2390 },
      profile("USD"),
      rates,
    );
    expect(result.ok).toBe(true);
  });

  it("[UNIT] a single-leg route sizes GBPAUD for a USD account with one request", async () => {
    const fetchQuote = vi.fn(async (symbol: string) => {
      expect(symbol).toBe("AUDUSD");
      return { bid: 0.65, ask: 0.67 };
    });
    const { rates, requests } = await resolveConversionRates("AUD", "USD", fetchQuote);
    expect(requests).toBe(1);
    expect(rates["AUDUSD"]).toBeCloseTo(0.66, 10);
    const result = calculateRisk(
      { instrument: "GBPAUD", entryPrice: 1.95, stopLoss: 1.94 },
      profile("USD"),
      rates,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.conversionRate).toBeCloseTo(0.66, 10);
  });

  it("[UNIT] a cross route synthesises the pair from two USD legs", async () => {
    const mids: Record<string, number> = { AUDUSD: 0.66, EURUSD: 1.1 };
    const fetchQuote = vi.fn(async (symbol: string) => ({
      bid: mids[symbol]!,
      ask: mids[symbol]!,
    }));
    const { rates } = await resolveConversionRates("AUD", "EUR", fetchQuote);
    expect(fetchQuote).toHaveBeenCalledTimes(2);
    expect(rates["AUDEUR"]).toBeCloseTo(0.66 / 1.1, 10);
  });

  it("[INVARIANT] an unavailable rate yields no_conversion_rate, not a fabricated size", async () => {
    const fetchQuote = vi.fn(async () => null);
    const { rates } = await resolveConversionRates("AUD", "USD", fetchQuote);
    const result = calculateRisk(
      { instrument: "GBPAUD", entryPrice: 1.95, stopLoss: 1.94 },
      profile("USD"),
      rates,
    );
    expect(result).toEqual({ ok: false, reason: "no_conversion_rate" });
  });
});
