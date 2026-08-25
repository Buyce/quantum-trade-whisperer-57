import { describe, expect, it } from "vitest";

import { proveConversion } from "../readiness-snapshot.server";

describe("live conversion proof (R5)", () => {
  it("[UNIT] a USD-quoted instrument still needs live legs for non-USD accounts", async () => {
    const requested: string[] = [];
    const { proof, requestCount } = await proveConversion("USD", async (symbol) => {
      requested.push(symbol);
      return { bid: 1.1, ask: 1.1002 };
    });

    const usd = proof.find((p) => p.accountCurrency === "USD");
    expect(usd?.route).toBe("parity");
    expect(usd?.legs).toEqual([]);
    expect(usd?.ok).toBe(true);
    // EUR, GBP and AUD each need exactly one major, de-duplicated.
    expect(requestCount).toBe(new Set(requested).size);
    expect(proof.every((p) => p.ok)).toBe(true);
  });

  it("[INVARIANT] a leg the broker will not quote makes conversion unproven, not assumed", async () => {
    const { proof } = await proveConversion("JPY", async (symbol) =>
      symbol === "USDJPY" ? null : { bid: 1.1, ask: 1.1002 },
    );
    const failing = proof.filter((p) => !p.ok);
    expect(failing.length).toBeGreaterThan(0);
    expect(failing.every((p) => p.missingLegs.includes("USDJPY"))).toBe(true);
  });

  it("[INVARIANT] a crossed or nonfinite leg quote counts as missing", async () => {
    const { proof } = await proveConversion("JPY", async () => ({ bid: 2, ask: 1 }));
    expect(proof.every((p) => p.accountCurrency === "JPY" || !p.ok)).toBe(true);
  });

  it("[INVARIANT] a throwing quote fetch never rejects the whole proof", async () => {
    const { proof } = await proveConversion("JPY", async () => {
      throw new Error("provider down");
    });
    expect(proof.length).toBeGreaterThan(0);
    expect(proof.some((p) => p.ok)).toBe(false);
  });
});
