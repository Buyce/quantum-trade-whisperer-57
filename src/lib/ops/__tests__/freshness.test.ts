import { describe, expect, it } from "vitest";
import { judgeFreshness } from "../freshness";
import { isWeekendClosed } from "@/lib/market-hours";

const tue = new Date("2026-11-10T13:20:00Z");
const U = ["EURUSD", "XAUUSD"];
const o = (instrument: string, result: string | null, finishedAt = "2026-11-10T13:10:00Z") => ({ instrument, result, finishedAt });

describe("pipeline freshness", () => {
  it("[INVARIANT] unreadable backend fails", () => {
    expect(judgeFreshness({ now: tue, readError: "PGRST303", universe: U, outcomes: [] }).ok).toBe(false);
  });
  it("[INVARIANT] idle-only (no finished jobs) fails as stale", () => {
    expect(judgeFreshness({ now: tue, readError: null, universe: U, outcomes: [] }).reason).toBe("stale");
  });
  it("[INVARIANT] stale-discarded jobs never count", () => {
    const r = judgeFreshness({ now: tue, readError: null, universe: U, outcomes: [o("EURUSD", "stale"), o("XAUUSD", "stale")] });
    expect(r.ok).toBe(false);
  });
  it("[INVARIANT] analysis with zero setups is healthy", () => {
    const r = judgeFreshness({ now: tue, readError: null, universe: U, outcomes: [o("EURUSD", "no_trade"), o("XAUUSD", "no_trade")] });
    expect(r).toMatchObject({ ok: true, reason: "fresh" });
  });
  it("[INVARIANT] an instrument with no finished outcome is partial", () => {
    const r = judgeFreshness({ now: tue, readError: null, universe: U, outcomes: [o("EURUSD", "no_trade")] });
    expect(r).toMatchObject({ ok: false, reason: "partial", missing: ["XAUUSD"] });
  });
  it("[INVARIANT] skipped-only fails; skipped alongside analysis is reported, not missing", () => {
    expect(judgeFreshness({ now: tue, readError: null, universe: U, outcomes: [o("EURUSD", "skipped"), o("XAUUSD", "skipped")] }).ok).toBe(false);
    const r = judgeFreshness({ now: tue, readError: null, universe: U, outcomes: [o("EURUSD", "no_trade"), o("XAUUSD", "skipped")] });
    expect(r).toMatchObject({ ok: true, skipped: ["XAUUSD"], missing: [] });
  });
  it("[INVARIANT] analysis older than 30 minutes is stale", () => {
    const r = judgeFreshness({ now: tue, readError: null, universe: U, outcomes: [o("EURUSD", "no_trade", "2026-11-10T12:49:00Z")] });
    expect(r.ok).toBe(false);
  });
  it("[INVARIANT] Sunday 21:30 UTC is open for both the probe and the scanner", () => {
    const sun = new Date("2026-11-15T21:30:00Z");
    expect(isWeekendClosed(sun)).toBe(false);
    expect(judgeFreshness({ now: sun, readError: null, universe: U, outcomes: [] }).ok).toBe(false);
  });
  it("[INVARIANT] weekly boundaries match the scanner calendar", () => {
    for (const t of ["2026-11-13T20:59:00Z", "2026-11-13T21:00:00Z", "2026-11-15T20:59:00Z", "2026-11-15T21:00:00Z"]) {
      const now = new Date(t);
      const r = judgeFreshness({ now, readError: null, universe: U, outcomes: [] });
      expect(r.reason === "market_closed").toBe(isWeekendClosed(now));
    }
    expect(isWeekendClosed(new Date("2026-11-13T21:00:00Z"))).toBe(true);
    expect(isWeekendClosed(new Date("2026-11-15T21:00:00Z"))).toBe(false);
  });
});
