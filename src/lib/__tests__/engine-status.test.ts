import { describe, expect, it } from "vitest";
import { classifyEngineError, classifyScanHealth, cooldownRemaining } from "@/lib/engine-status";

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

describe("classifyScanHealth", () => {
  it("reports RUNNING when the window has no failures", () => {
    const h = classifyScanHealth({ total: 12, failed: 0, succeeded: 12 });
    expect(h.state).toBe("running");
    expect(h.value).toBe("RUNNING");
    expect(h.errorIsCurrent).toBe(false);
  });

  it("reports NO CYCLES for an empty window", () => {
    const h = classifyScanHealth({ total: 0, failed: 0, succeeded: 0 });
    expect(h.state).toBe("no_cycles");
    expect(h.value).toBe("NO CYCLES");
    expect(h.errorIsCurrent).toBe(false);
  });

  it("reports FAILING when every cycle in the window failed", () => {
    const h = classifyScanHealth({
      total: 9,
      failed: 9,
      succeeded: 0,
      last_failure_at: "2026-08-23T03:45:00Z",
      last_success_at: null,
    });
    expect(h.state).toBe("failing");
    expect(h.tone).toBe("bad");
    expect(h.errorIsCurrent).toBe(true);
  });

  it("reports RECOVERED when the newest cycle succeeded after the last failure", () => {
    const h = classifyScanHealth({
      total: 18,
      failed: 3,
      succeeded: 15,
      last_failure_at: "2026-08-23T03:45:02Z",
      last_success_at: "2026-08-23T04:30:09Z",
    });
    expect(h.state).toBe("recovered");
    expect(h.value).toBe("RECOVERED");
    // The stored provider/billing error has healed and must not be shown as current.
    expect(h.errorIsCurrent).toBe(false);
  });

  it("stays DEGRADED while the newest failure is more recent than the newest success", () => {
    const h = classifyScanHealth({
      total: 18,
      failed: 3,
      succeeded: 15,
      last_failure_at: "2026-08-23T04:30:09Z",
      last_success_at: "2026-08-23T03:45:02Z",
    });
    expect(h.state).toBe("degraded");
    expect(h.errorIsCurrent).toBe(true);
  });

  it("treats a failure with no recorded success in the window as still current", () => {
    const h = classifyScanHealth({
      total: 4,
      failed: 1,
      succeeded: 3,
      last_failure_at: "2026-08-23T04:30:09Z",
      last_success_at: null,
    });
    expect(h.state).toBe("degraded");
    expect(h.errorIsCurrent).toBe(true);
  });
});
