import { describe, expect, it } from "vitest";
import { classifyEngineError, cooldownRemaining } from "@/lib/engine-status";

describe("classifyEngineError", () => {
  it("[UNIT] treats no error as no error", () => {
    expect(classifyEngineError(null).kind).toBe("none");
    expect(classifyEngineError("   ").kind).toBe("none");
  });

  it("[UNIT] labels provider billing refusals as access problems, not No Trade", () => {
    const c = classifyEngineError(
      'MetaApi 400 for EURUSD H4: {"error":"ValidationError","message":"To allow market data access please top up your account."}',
    );
    expect(c.kind).toBe("provider_access");
    expect(c.explanation).toMatch(/missing, not empty/i);
    expect(c.explanation).toMatch(/not a scanner-wide No Trade/i);
  });

  it("[UNIT] labels generic provider fetch failures as missing data", () => {
    const c = classifyEngineError("All instrument candle fetches failed");
    expect(c.kind).toBe("provider");
    expect(c.explanation).toMatch(/missing data/i);
  });

  it("[UNIT] labels our own failures as engine errors", () => {
    expect(classifyEngineError("TypeError: cannot read property x").kind).toBe("engine");
  });
});

describe("cooldownRemaining", () => {
  const now = Date.parse("2026-08-23T04:00:00Z");

  it("[UNIT] returns null when unset or elapsed", () => {
    expect(cooldownRemaining(null, now)).toBeNull();
    expect(cooldownRemaining("2026-08-23T03:00:00Z", now)).toBeNull();
    expect(cooldownRemaining("not-a-date", now)).toBeNull();
  });

  it("[UNIT] formats minutes and hours", () => {
    expect(cooldownRemaining("2026-08-23T04:20:00Z", now)).toBe("20m");
    expect(cooldownRemaining("2026-08-23T06:30:00Z", now)).toBe("2h 30m");
  });
});
